#include "fabric_surface.h"
#include "fabric_application.h"
#include "game_service_registry.h"
#include "svg_node.h"
#include "paragraph_view.h"
#include "switch_view.h"
#include "activity_indicator_view.h"
#include "accessible_view.h"
#include "appearance_adapter.h"
#include "native_animated.h"
#include "modal_window_stack.h"
#include <godot_cpp/godot.hpp>
#include <godot_cpp/variant/utility_functions.hpp>

void initialize_fabric(godot::ModuleInitializationLevel level) {
  if (level == godot::MODULE_INITIALIZATION_LEVEL_SCENE) {
    // Before any application runtime exists, as RN's app factories do.
    const auto flags = fabric_godot::configure_react_native_feature_flags();
    if (!flags.empty()) godot::UtilityFunctions::push_error(godot::String("FABRIC_ERROR: ") + flags.c_str());
    godot::ClassDB::register_class<GodotBorderStyleBox>();
    godot::ClassDB::register_class<GodotSvgNode>();
    godot::ClassDB::register_class<GodotParagraph>();
    godot::ClassDB::register_class<GodotSwitch>();
    godot::ClassDB::register_class<GodotActivityIndicator>();
    godot::ClassDB::register_class<GodotAccessibleView>();
    godot::ClassDB::register_class<GodotFabricBinding>();
    godot::ClassDB::register_class<fabric_godot::ModalWindowStack>();
    godot::ClassDB::register_class<FabricApplication>();
    godot::ClassDB::register_class<FabricSurface>();
  }
}
void terminate_fabric(godot::ModuleInitializationLevel level) {
  if (level == godot::MODULE_INITIALIZATION_LEVEL_SCENE) FabricApplication::release_system_theme_callback();
}
extern "C" GDExtensionBool GDE_EXPORT fabric_library_init(
    GDExtensionInterfaceGetProcAddress get_proc_address, GDExtensionClassLibraryPtr library,
    GDExtensionInitialization *initialization) {
  godot::GDExtensionBinding::InitObject init(get_proc_address, library, initialization);
  init.register_initializer(initialize_fabric);
  init.register_terminator(terminate_fabric);
  init.set_minimum_library_initialization_level(godot::MODULE_INITIALIZATION_LEVEL_SCENE);
  return init.init();
}
