#include "godot_websocket_transport.h"
#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/variant/utility_functions.hpp>
#include <godot_cpp/core/class_db.hpp>

using namespace godot;

class WebSocketTransportTestFixture final : public RefCounted {
  GDCLASS(WebSocketTransportTestFixture, RefCounted)

 public:
  void begin(const String &url, const String &action, bool stop) {
    transport_ = fabric_godot::make_godot_websocket_transport();
    action_ = action.utf8().get_data();
    const std::string endpoint = url.utf8().get_data();
    greeting_ = endpoint.find("/greeting") != std::string::npos;
    stop_ = stop;
    fabric_godot::WebSocketListener listener;
    listener.on_open = [this](std::string) {
      ++opened_;
      act("open");
    };
    listener.on_message = [this](fabric_godot::WebSocketMessage) {
      ++messages_;
      act("message");
    };
    listener.on_closed = [this](int, std::string) { ++closed_; };
    listener.on_failure = [this](std::string) { ++failed_; };
    const auto error = transport_->start(1, {endpoint, {}, {}}, std::move(listener));
    if (error) UtilityFunctions::push_error(String("WEBSOCKET_FIXTURE_START_FAILED: ") + error->c_str());
  }

  void advance() {
    if (transport_) transport_->poll(1024 * 1024, 256);
  }

  Dictionary result() const {
    Dictionary value;
    value["opened"] = opened_;
    value["messages"] = messages_;
    value["closed"] = closed_;
    value["failed"] = failed_;
    value["actions"] = actions_;
    value["active"] = transport_ ? transport_->snapshot()["active"].asInt() : 0;
    value["stopped"] = stopped_;
    return value;
  }

 protected:
  static void _bind_methods() {
    ClassDB::bind_method(D_METHOD("begin", "url", "action", "stop"), &WebSocketTransportTestFixture::begin);
    ClassDB::bind_method(D_METHOD("advance"), &WebSocketTransportTestFixture::advance);
    ClassDB::bind_method(D_METHOD("result"), &WebSocketTransportTestFixture::result);
  }

 private:
  void act(const char *event) {
    if (action_ == "message" && !greeting_ && event == std::string("open")) {
      transport_->send(1, {true, "trigger"});
      return;
    }
    if (action_ != event || actions_ != 0 || !transport_) return;
    ++actions_;
    if (stop_) {
      stopped_ = true;
      transport_->stop();
    } else {
      transport_->cancel(1);
    }
  }

  std::unique_ptr<fabric_godot::WebSocketTransport> transport_;
  std::string action_;
  int opened_{};
  int messages_{};
  int closed_{};
  int failed_{};
  int actions_{};
  bool stop_{};
  bool stopped_{};
  bool greeting_{};
};

static void initialize_websocket_transport_test(ModuleInitializationLevel level) {
  if (level == MODULE_INITIALIZATION_LEVEL_SCENE) ClassDB::register_class<WebSocketTransportTestFixture>();
}

extern "C" GDExtensionBool GDE_EXPORT websocket_transport_test_library_init(
    GDExtensionInterfaceGetProcAddress get_proc_address, GDExtensionClassLibraryPtr library,
    GDExtensionInitialization *initialization) {
  GDExtensionBinding::InitObject init(get_proc_address, library, initialization);
  init.register_initializer(initialize_websocket_transport_test);
  init.set_minimum_library_initialization_level(MODULE_INITIALIZATION_LEVEL_SCENE);
  return init.init();
}
