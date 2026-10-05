#include "fabric_surface.h"
#include "fabric_application.h"
#include "game_service_registry.h"
#include "svg_node.h"
#include "paragraph_view.h"
#include "switch_view.h"
#include "appearance_adapter.h"
#include <godot_cpp/godot.hpp>

void initialize_fabric(godot::ModuleInitializationLevel level) {
  if (level == godot::MODULE_INITIALIZATION_LEVEL_SCENE) {
    godot::ClassDB::register_class<GodotBorderStyleBox>();
    godot::ClassDB::register_class<GodotSvgNode>();
    godot::ClassDB::register_class<GodotParagraph>();
    godot::ClassDB::register_class<GodotSwitch>();
    godot::ClassDB::register_class<GodotFabricBinding>();
    godot::ClassDB::register_class<FabricApplication>();
    godot::ClassDB::register_class<FabricSurface>();
  }
}
void terminate_fabric(godot::ModuleInitializationLevel) {}
extern "C" GDExtensionBool GDE_EXPORT fabric_library_init(
    GDExtensionInterfaceGetProcAddress get_proc_address, GDExtensionClassLibraryPtr library,
    GDExtensionInitialization *initialization) {
  godot::GDExtensionBinding::InitObject init(get_proc_address, library, initialization);
  init.register_initializer(initialize_fabric);
  init.register_terminator(terminate_fabric);
  init.set_minimum_library_initialization_level(godot::MODULE_INITIALIZATION_LEVEL_SCENE);
  return init.init();
}
