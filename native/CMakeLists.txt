cmake_minimum_required(VERSION 3.31)
project(godot_fabric LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(CMAKE_OSX_DEPLOYMENT_TARGET 13.0)
set(RN "${CMAKE_CURRENT_SOURCE_DIR}/../.deps/package/ReactCommon")
set(DEPS "${CMAKE_CURRENT_SOURCE_DIR}/../.deps/rndeps/packages/react-native/third-party")
set(HERMES "${CMAKE_CURRENT_SOURCE_DIR}/../.deps/hermes/destroot")

# Only upstream portable sources. No mobile renderer, modified reconciler, or
# replacement implementation of Fabric is compiled here.
set(MODULES
  react/debug react/featureflags react/utils react/timing
  react/renderer/core react/renderer/components/view react/renderer/components/root
  react/renderer/components/scrollview react/renderer/components/text
  react/renderer/textlayoutmanager react/renderer/componentregistry
  react/renderer/components/legacyviewmanagerinterop
  react/renderer/graphics react/renderer/debug react/renderer/mapbuffer
  react/renderer/telemetry react/renderer/mounting react/renderer/uimanager
  react/renderer/uimanager/consistency react/renderer/consistency
  react/renderer/bridging react/renderer/dom react/renderer/leakchecker
  react/renderer/runtimescheduler react/renderer/animationbackend
  react/renderer/attributedstring react/renderer/observers/events
  react/renderer/viewtransition react/performance/timeline
  react/performance/cdpmetrics jsinspector-modern/tracing
  reactperflogger/reactperflogger jserrorhandler logger oscompat)
set(SOURCES "${RN}/jsi/jsi/jsi.cpp" "${RN}/jsi/jsi/JSIDynamic.cpp"
  "${RN}/react/runtime/TimerManager.cpp"
  "${RN}/runtimeexecutor/platform/cxx/ReactCommon/RuntimeExecutorSyncUIThreadUtils.cpp")
foreach(MODULE IN LISTS MODULES)
  file(GLOB MODULE_SOURCES CONFIGURE_DEPENDS "${RN}/${MODULE}/*.cpp")
  list(APPEND SOURCES ${MODULE_SOURCES})
endforeach()
file(GLOB MOUNT_INTERNAL CONFIGURE_DEPENDS "${RN}/react/renderer/mounting/internal/*.cpp")
file(GLOB_RECURSE YOGA CONFIGURE_DEPENDS "${RN}/yoga/yoga/*.cpp")
list(FILTER YOGA EXCLUDE REGEX "/tests/")
list(APPEND SOURCES ${MOUNT_INTERNAL} ${YOGA})
list(APPEND SOURCES "${RN}/react/renderer/textlayoutmanager/platform/cxx/react/renderer/textlayoutmanager/TextLayoutManager.cpp")
list(APPEND SOURCES
  "${RN}/jsinspector-modern/ConsoleTaskOrchestrator.cpp"
  "${RN}/jsinspector-modern/ConsoleTaskContext.cpp"
  "${RN}/jsinspector-modern/ConsoleTask.cpp"
  "${RN}/jsinspector-modern/network/HttpUtils.cpp"
  "${RN}/jsinspector-modern/network/CdpNetwork.cpp")
list(FILTER SOURCES EXCLUDE REGEX "RuntimeScheduler_Legacy.cpp|JSConsole.cpp")
add_library(fabric_core STATIC ${SOURCES})
target_compile_definitions(fabric_core PUBLIC
  RCT_REMOVE_LEGACY_ARCH=1 RN_ALLOW_FRAMEWORKS=1
  FOLLY_MOBILE=1 FOLLY_USE_LIBCPP=1 FOLLY_CFG_NO_COROUTINES=1
  FOLLY_HAVE_CLOCK_GETTIME=1)
target_compile_options(fabric_core PRIVATE -Wno-deprecated-declarations)
target_include_directories(fabric_core PUBLIC
  "${RN}" "${RN}/jsi" "${RN}/yoga" "${RN}/callinvoker" "${RN}/runtimeexecutor"
  "${RN}/reactperflogger"
  "${RN}/react/renderer/components/view/platform/cxx"
  "${RN}/react/renderer/components/scrollview/platform/cxx"
  "${RN}/react/renderer/components/text/platform/cxx"
  "${RN}/react/renderer/textlayoutmanager/platform/cxx"
  "${RN}/react/renderer/graphics/platform/cxx"
  "${RN}/react/utils/platform/cxx"
  "${RN}/runtimeexecutor/platform/cxx"
  "${RN}/react/runtime/nativeviewconfig/platform/cxx"
  "${HERMES}/include"
  "${DEPS}/ReactNativeDependenciesHeaders.xcframework/macos-arm64_x86_64/Headers")
target_link_libraries(fabric_core PUBLIC
  "${DEPS}/ReactNativeDependencies.xcframework/macos-arm64_x86_64/ReactNativeDependencies.framework/ReactNativeDependencies"
  "${HERMES}/Library/Frameworks/macosx/hermesvm.framework/hermesvm")
add_executable(fabric_smoke smoke.cpp)
target_link_libraries(fabric_smoke PRIVATE fabric_core)
add_executable(timer_registry_test timer_registry_test.cpp)
target_include_directories(timer_registry_test PRIVATE "${RN}")

set(GODOTCPP_TARGET template_release CACHE STRING "" FORCE)
set(GODOTCPP_BUILD_PROFILE "${CMAKE_CURRENT_SOURCE_DIR}/godot-profile.json" CACHE FILEPATH "" FORCE)
add_subdirectory("../.deps/godot-cpp-da26c1732ee8656ef9ccad587cbdd55acf8637c8" godot-cpp)
add_library(fabric_godot SHARED fabric_application.cpp application_runtime.cpp fabric_surface.cpp text_layout.cpp paragraph_layout.cpp paragraph_view.cpp input_adapter.cpp pointer_adapter.cpp svg_node.cpp scroll_adapter.cpp appearance_adapter.cpp register.cpp)
target_link_libraries(fabric_godot PRIVATE fabric_core godot-cpp)
set_target_properties(fabric_godot PROPERTIES
  PREFIX "" SUFFIX ".dylib"
  LIBRARY_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/../addons"
  BUILD_WITH_INSTALL_RPATH TRUE
  INSTALL_RPATH "@loader_path/frameworks")
