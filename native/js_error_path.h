#pragma once

// RN's error path for one application (GF-05 slice C). ReactInstance owns a JsErrorHandler (ReactCommon/jserrorhandler,
// compiled unchanged), installs RN$handleException, RN$inExceptionHandler, RN$registerExceptionListener, RN$isRuntimeReady and
// RN$useAlwaysAvailableJSErrorHandling over it, hands it every exception that escapes a JS task, and marks the runtime ready after
// the bundle. This is that part of ReactInstance for
// this host, plus the ExceptionsManager module that RN's JS (ExceptionsManager.js, through setUpErrorHandling) reports to.
// RN's iOS and Android hosts send the exceptions of both routes to the same place (RCTExceptionsManager and
// ExceptionsManagerModule); here the place is the sink the application hands over, which records a fatal exception as a host
// failure and logs a soft one.

#include <ReactCommon/TurboModule.h>
#include <folly/dynamic.h>
#include <jsi/jsi.h>
#include <exception>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace fabric_godot {
struct ExceptionFrame {
  std::string method;
  std::optional<std::string> file;
  std::optional<double> line;
  std::optional<double> column;
};

// One exception as RN's ExceptionsManager.js hands it to NativeExceptionsManager.reportException (and as JsErrorHandler's C++
// pipeline builds it before the runtime is ready): the message RN composed (name and component stack included), the parsed
// stack, and whether the exception is fatal.
struct ExceptionReport {
  bool fatal{};
  std::string message;
  std::vector<ExceptionFrame> stack;
  double id{};
};

// The text of a report: Android's JSStackTrace.format (message, ", stack:" and one "method@file:line:column" line per frame,
// where Android keeps only the id of a bundle segment in place of the file, and -1 for a missing line).
std::string format_exception(const ExceptionReport &report);

class JsErrorPath {
 public:
  using Sink = std::function<void(const ExceptionReport &)>;

  // The name the ExceptionsManager module is registered under (NativeExceptionsManager.js asks for it with getEnforcing).
  static constexpr const char *module_name = "ExceptionsManager";

  explicit JsErrorPath(Sink sink);
  ~JsErrorPath();
  // ReactInstance::initializeRuntime's RN$useAlwaysAvailableJSErrorHandling, RN$isRuntimeReady, RN$inExceptionHandler,
  // RN$handleException and RN$registerExceptionListener; not RN$hasHandledFatalException and RN$notifyOfFatalException (V2-D26).
  void install(facebook::jsi::Runtime &runtime);
  // What ReactInstance does with an exception that escapes a JS task (its runtime executor and its RuntimeScheduler): a fatal
  // error for JsErrorHandler. A std::exception that is not a JS error becomes one, as in ReactInstance.
  void handle_fatal(facebook::jsi::Runtime &runtime, facebook::jsi::JSError &error);
  void handle_fatal(facebook::jsi::Runtime &runtime, const std::exception &error);
  // ReactInstance::loadScript: the runtime is ready after the bundle evaluated, unless a fatal error was already handled.
  void bundle_evaluated();
  // The ExceptionsManager TurboModule: the native end of RN's JS error path.
  std::shared_ptr<facebook::react::TurboModule> make_module(const std::shared_ptr<facebook::react::CallInvoker> &invoker);
  // Drops the JS functions registered as exception listeners; before the VM is destroyed.
  void release();
  folly::dynamic snapshot() const;

  // What the application, the module and the globals share; defined in js_error_path.cpp.
  struct State;

 private:
  std::shared_ptr<State> state_;
};
}
