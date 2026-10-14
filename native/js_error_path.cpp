#include "js_error_path.h"
#include "FBReactNativeSpecJSI.h"
#include <jserrorhandler/JsErrorHandler.h>
#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/utils/jsi-utils.h>
#include <cstdint>
#include <deque>
#include <string_view>
#include <typeinfo>
#include <utility>

namespace rn = facebook::react;
namespace jsi = facebook::jsi;

namespace fabric_godot {
namespace {
// How many reports the snapshot keeps: the last ones, for a probe that wants to see what reached the host.
constexpr std::size_t retained_reports = 32;

// What ReactInstance's runtime executor makes of an exception that is not a JS error (ReactInstance.cpp:104-108): a JS error whose
// message starts with this, spelled as RN spells it there. RN spells the wrap of its RuntimeScheduler differently ("Non-js exception: ",
// RuntimeScheduler_Modern.cpp:402 and 442); that one is made by RN's compiled scheduler, not by the host, and the oracle reads both
// spellings from the pinned sources and checks this one against ReactInstance.cpp.
constexpr const char *non_js_exception_prefix = "Non-JS exception: ";
// The wrap of RuntimeScheduler_Modern::executeTask and performMicrotaskCheckpoint (RuntimeScheduler_Modern.cpp:402 and 442): slice F's catch
// sites that stand for RN's scheduler tasks and its microtask checkpoint spell it as the scheduler does.
constexpr const char *task_non_js_exception_prefix = "Non-js exception: ";

// ReactInstance.cpp:423, copied: the truthiness JS gives a value.
bool is_truthy(jsi::Runtime &runtime, const jsi::Value &value) {
  auto Boolean = runtime.global().getPropertyAsFunction(runtime, "Boolean");
  return Boolean.call(runtime, value).getBool();
}

// Hermes throws its own copy of jsi::JSError (hermesvm.framework defines and exports one), whose type_info is not this library's, so a
// `catch (jsi::JSError &)` here or in RN's compiled code never matches what Hermes throws: it arrives as a std::exception. The two
// classes are the same source (the jsi.h of the Hermes build is the one RN pins, byte for byte), so a std::exception whose dynamic type
// has the name of jsi::JSError is one, and the JS error it carries is the one to report.
jsi::JSError *js_error_of(const std::exception &error) {
  if (std::string_view(typeid(error).name()) != std::string_view(typeid(jsi::JSError).name())) return nullptr;
  return const_cast<jsi::JSError *>(static_cast<const jsi::JSError *>(&error));
}

std::optional<std::string> read_string(jsi::Runtime &runtime, const jsi::Object &object, const char *name) {
  const auto value = object.getProperty(runtime, name);
  if (!value.isString()) return std::nullopt;
  return value.getString(runtime).utf8(runtime);
}

std::optional<double> read_number(jsi::Runtime &runtime, const jsi::Object &object, const char *name) {
  const auto value = object.getProperty(runtime, name);
  if (!value.isNumber()) return std::nullopt;
  return value.getNumber();
}

// The frames of the `stack` RN's parseErrorStack produced: {methodName, file, lineNumber, column}, the last three possibly null.
std::vector<ExceptionFrame> read_stack(jsi::Runtime &runtime, const jsi::Array &stack) {
  std::vector<ExceptionFrame> frames;
  const auto count = stack.size(runtime);
  for (std::size_t index = 0; index < count; ++index) {
    const auto entry = stack.getValueAtIndex(runtime, index);
    if (!entry.isObject()) continue;
    const auto frame = entry.getObject(runtime);
    frames.push_back({read_string(runtime, frame, "methodName").value_or(""), read_string(runtime, frame, "file"),
        read_number(runtime, frame, "lineNumber"), read_number(runtime, frame, "column")});
  }
  return frames;
}
}

std::string format_exception(const ExceptionReport &report) {
  std::string text = report.message + ", stack:\n";
  for (const auto &frame : report.stack) {
    text += frame.method + "@";
    if (frame.file && !frame.file->empty()) text += *frame.file + ":";
    text += std::to_string(frame.line ? static_cast<long long>(*frame.line) : -1LL);
    if (frame.column) text += ":" + std::to_string(static_cast<long long>(*frame.column));
    text += "\n";
  }
  return text;
}

struct JsErrorPath::State {
  // Which route brought a report: ExceptionsManager.js through the module, or JsErrorHandler's C++ pipeline (the runtime was
  // not ready, or an exception escaped a task before JS could report it).
  enum class Origin { Module, Handler };
  struct Counts { uint64_t soft{}, fatal{}; };
  struct Retained { Origin origin; bool fatal; std::string message; std::size_t frames; double id; };

  Sink sink;
  std::shared_ptr<rn::JsErrorHandler> handler;
  // ReactInstance keeps these in the closure of RN$registerExceptionListener; here the state owns them, so that the application
  // can drop them before it destroys the VM.
  std::vector<std::shared_ptr<jsi::Function>> listeners;
  Counts module_counts, handler_counts;
  std::deque<Retained> reports;

  void deliver(Origin origin, ExceptionReport report) {
    auto &counts = origin == Origin::Module ? module_counts : handler_counts;
    ++(report.fatal ? counts.fatal : counts.soft);
    reports.push_back({origin, report.fatal, report.message, report.stack.size(), report.id});
    if (reports.size() > retained_reports) reports.pop_front();
    if (sink) sink(report);
  }
};

namespace {
using State = JsErrorPath::State;

// NativeExceptionsManager.reportException with RN's ExceptionData: ExceptionsManagerModule.kt's reportException reads the same
// fields (message, stack, isFatal), and RCTExceptionsManager.mm's decides between its fatal and soft reports on isFatal.
class NativeExceptionsManager final : public rn::NativeExceptionsManagerCxxSpec<NativeExceptionsManager> {
 public:
  NativeExceptionsManager(const std::shared_ptr<rn::CallInvoker> &invoker, std::shared_ptr<State> state)
      : rn::NativeExceptionsManagerCxxSpec<NativeExceptionsManager>(invoker), state_(std::move(state)) {}

  // Deprecated in RN's spec (reportException replaces them); the JS wrapper falls back to them when reportException is absent.
  void reportFatalException(jsi::Runtime &runtime, jsi::String message, jsi::Array stack, double id) {
    report(true, message.utf8(runtime), read_stack(runtime, stack), id);
  }
  void reportSoftException(jsi::Runtime &runtime, jsi::String message, jsi::Array stack, double id) {
    report(false, message.utf8(runtime), read_stack(runtime, stack), id);
  }
  void reportException(jsi::Runtime &runtime, jsi::Object data) {
    const auto stack = data.getProperty(runtime, "stack");
    const auto id = read_number(runtime, data, "id");
    const auto fatal = data.getProperty(runtime, "isFatal");
    report(fatal.isBool() && fatal.getBool(), read_string(runtime, data, "message").value_or(""),
        stack.isObject() && stack.getObject(runtime).isArray(runtime) ? read_stack(runtime, stack.getObject(runtime).getArray(runtime))
                                                                       : std::vector<ExceptionFrame>{},
        id.value_or(0));
  }
  // Android hides its redbox here and iOS does nothing (the spec says so); this host has no redbox.
  void dismissRedbox(jsi::Runtime &) {}

 private:
  std::shared_ptr<State> state_;
  void report(bool fatal, std::string message, std::vector<ExceptionFrame> stack, double id) {
    state_->deliver(State::Origin::Module, {fatal, std::move(message), std::move(stack), id});
  }
};

// JsErrorHandler's onJsError: ProcessedError is the same data in C++ (RCTInstance.mm's _handleJSError builds ExceptionData from
// it and calls the module's reportException; Android hands it to ReactExceptionManager).
ExceptionReport report_of(const rn::JsErrorHandler::ProcessedError &error) {
  ExceptionReport report{error.isFatal, error.message, {}, static_cast<double>(error.id)};
  for (const auto &frame : error.stack) {
    report.stack.push_back({frame.methodName, frame.file, frame.lineNumber ? std::optional<double>(*frame.lineNumber) : std::nullopt,
        frame.column ? std::optional<double>(*frame.column) : std::nullopt});
  }
  return report;
}
}

JsErrorPath::JsErrorPath(Sink sink) : state_(std::make_shared<State>()) {
  state_->sink = std::move(sink);
  std::weak_ptr<State> owner = state_;
  state_->handler = std::make_shared<rn::JsErrorHandler>(
      [owner](jsi::Runtime &, const rn::JsErrorHandler::ProcessedError &error) {
        if (auto state = owner.lock()) state->deliver(State::Origin::Handler, report_of(error));
      });
}
JsErrorPath::~JsErrorPath() = default;

// ReactInstance.cpp:451-600 (initializeRuntime), line for line apart from the closure state: five of the seven globals of its error
// family, with the same semantics and the flag's pinned default (useAlwaysAvailableJSErrorHandling is false). RN$hasHandledFatalException
// and RN$notifyOfFatalException are left out on purpose: with them ExceptionsManager.js (lines 127-130) reports only the first fatal
// exception, which suits RN's crash on a fatal error and not this host, where the runtime keeps running after an uncaught error (V2-D26;
// GF-07's error-cleanup slice owns any change).
void JsErrorPath::install(jsi::Runtime &runtime) {
  auto handler = state_->handler;
  std::weak_ptr<State> owner = state_;

  rn::defineReadOnlyGlobal(runtime, "RN$useAlwaysAvailableJSErrorHandling",
      jsi::Value(rn::ReactNativeFeatureFlags::useAlwaysAvailableJSErrorHandling()));

  rn::defineReadOnlyGlobal(runtime, "RN$isRuntimeReady",
      jsi::Function::createFromHostFunction(runtime, jsi::PropNameID::forAscii(runtime, "isRuntimeReady"), 0,
          [handler](jsi::Runtime &, const jsi::Value &, const jsi::Value *, size_t) { return handler->isRuntimeReady(); }));

  rn::defineReadOnlyGlobal(runtime, "RN$inExceptionHandler",
      jsi::Function::createFromHostFunction(runtime, jsi::PropNameID::forAscii(runtime, "inExceptionHandler"), 0,
          [handler](jsi::Runtime &, const jsi::Value &, const jsi::Value *, size_t) { return handler->inErrorHandler(); }));

  rn::defineReadOnlyGlobal(runtime, "RN$handleException",
      jsi::Function::createFromHostFunction(runtime, jsi::PropNameID::forAscii(runtime, "handleException"), 3,
          [handler](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t count) {
            if (count < 2) {
              throw jsi::JSError(runtime, "handleException requires 3 arguments: error, isFatal, logToConsole (optional)");
            }
            auto isFatal = is_truthy(runtime, args[1]);
            if (!rn::ReactNativeFeatureFlags::useAlwaysAvailableJSErrorHandling()) {
              if (handler->isRuntimeReady()) {
                return jsi::Value(false);
              }
            }
            auto jsError = jsi::JSError(runtime, jsi::Value(runtime, args[0]));
            if (count == 2) {
              handler->handleError(runtime, jsError, isFatal);
            } else {
              auto logToConsole = is_truthy(runtime, args[2]);
              handler->handleError(runtime, jsError, isFatal, logToConsole);
            }
            return jsi::Value(true);
          }));

  rn::defineReadOnlyGlobal(runtime, "RN$registerExceptionListener",
      jsi::Function::createFromHostFunction(runtime, jsi::PropNameID::forAscii(runtime, "registerExceptionListener"), 1,
          [handler, owner](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t count) {
            if (count < 1) {
              throw jsi::JSError(runtime, "registerExceptionListener: requires 1 argument: fn");
            }
            if (!args[0].isObject() || !args[0].getObject(runtime).isFunction(runtime)) {
              throw jsi::JSError(runtime, "registerExceptionListener: The first argument must be a function");
            }
            auto errorListener = std::make_shared<jsi::Function>(args[0].getObject(runtime).getFunction(runtime));
            if (auto state = owner.lock()) state->listeners.emplace_back(errorListener);
            handler->registerErrorListener([weakErrorListener = std::weak_ptr<jsi::Function>(errorListener)](
                                               jsi::Runtime &runtime, jsi::Value data) {
              if (auto strongErrorListener = weakErrorListener.lock()) {
                strongErrorListener->call(runtime, data);
              }
            });
            return jsi::Value::undefined();
          }));
}

// What ReactInstance's runtime executor does with an exception that escapes a task (ReactInstance.cpp:92-109), and the error
// handler it gives its RuntimeScheduler (ReactInstance.cpp:128-131). A report that fails to be handled is still a failure:
// the sink gets it as it came. (RN's own `catch (jsi::JSError &)` inside JsErrorHandler does not match Hermes' errors either, see
// js_error_of: an error raised while it reports, a listener that throws say, reaches this net and not the next listener.)
void JsErrorPath::handle_fatal(jsi::Runtime &runtime, jsi::JSError &error) {
  try {
    state_->handler->handleError(runtime, error, true);
  } catch (const std::exception &failure) {
    state_->deliver(State::Origin::Handler, {true, std::string(error.what()) + " (the error handler failed: " + failure.what() + ")", {}, 0});
  }
}
void JsErrorPath::handle_fatal(jsi::Runtime &runtime, const std::exception &error) {
  report_fatal(runtime, error, non_js_exception_prefix);
}
void JsErrorPath::handle_task_error(jsi::Runtime &runtime, const std::exception &error) {
  report_fatal(runtime, error, task_non_js_exception_prefix);
}
// A Hermes JSError is reported as the JS error it carries; anything else is wrapped as a JS error whose message starts with `prefix`.
void JsErrorPath::report_fatal(jsi::Runtime &runtime, const std::exception &error, const char *prefix) {
  if (auto *js_error = js_error_of(error)) {
    handle_fatal(runtime, *js_error);
    return;
  }
  try {
    jsi::JSError wrapped(runtime, std::string(prefix) + error.what());
    handle_fatal(runtime, wrapped);
  } catch (const std::exception &failure) {
    state_->deliver(State::Origin::Handler, {true, std::string(prefix) + error.what() + " (" + failure.what() + ")", {}, 0});
  }
}

// ReactInstance.cpp:296-298.
void JsErrorPath::bundle_evaluated() {
  if (!state_->handler->hasHandledFatalError()) state_->handler->setRuntimeReady();
}

std::shared_ptr<rn::TurboModule> JsErrorPath::make_module(const std::shared_ptr<rn::CallInvoker> &invoker) {
  return std::make_shared<NativeExceptionsManager>(invoker, state_);
}

void JsErrorPath::release() { state_->listeners.clear(); }

folly::dynamic JsErrorPath::snapshot() const {
  const auto counts = [](const State::Counts &value) { return folly::dynamic::object("soft", static_cast<int64_t>(value.soft))("fatal", static_cast<int64_t>(value.fatal)); };
  folly::dynamic reports = folly::dynamic::array();
  for (const auto &report : state_->reports) {
    reports.push_back(folly::dynamic::object("origin", report.origin == State::Origin::Module ? "module" : "handler")
        ("fatal", report.fatal)("message", report.message)("frames", report.frames)("id", report.id));
  }
  return folly::dynamic::object("runtimeReady", state_->handler->isRuntimeReady())
      ("handledFatalError", state_->handler->hasHandledFatalError())("inHandler", state_->handler->inErrorHandler())
      ("listeners", state_->listeners.size())("module", counts(state_->module_counts))("handler", counts(state_->handler_counts))
      ("reports", std::move(reports));
}
}
