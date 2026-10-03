cmake_minimum_required(VERSION 3.31)
project(godot_fabric LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
if(NOT CMAKE_SYSTEM_NAME STREQUAL "iOS")
  set(CMAKE_OSX_DEPLOYMENT_TARGET 13.0)
endif()
set(RN "${CMAKE_CURRENT_SOURCE_DIR}/../.deps/package/ReactCommon")
set(DEPS "${CMAKE_CURRENT_SOURCE_DIR}/../.deps/rndeps/packages/react-native/third-party")
set(HERMES "${CMAKE_CURRENT_SOURCE_DIR}/../.deps/hermes/destroot")
if(CMAKE_SYSTEM_NAME STREQUAL "iOS")
  # CMake's Apple SDK detection may leave SYSTEM_PROCESSOR empty even though
  # the compiler receives -arch. godot-cpp uses it for its archive/ABI identity.
  set(CMAKE_SYSTEM_PROCESSOR "${CMAKE_OSX_ARCHITECTURES}")
  string(TOLOWER "${CMAKE_OSX_SYSROOT}" IOS_SDK_PATH)
  if(IOS_SDK_PATH MATCHES "iphonesimulator")
    set(APPLE_DEPENDENCY_SLICE "ios-arm64_x86_64-simulator")
  elseif(IOS_SDK_PATH MATCHES "iphoneos")
    set(APPLE_DEPENDENCY_SLICE "ios-arm64")
  else()
    message(FATAL_ERROR "iOS requires an explicit iphoneos or iphonesimulator SDK")
  endif()
  set(HERMES_LIBRARY "${HERMES}/Library/Frameworks/universal/hermesvm.xcframework/${APPLE_DEPENDENCY_SLICE}/hermesvm.framework/hermesvm")
else()
  set(APPLE_DEPENDENCY_SLICE "macos-arm64_x86_64")
  set(HERMES_LIBRARY "${HERMES}/Library/Frameworks/macosx/hermesvm.framework/hermesvm")
endif()
set(RN_DEPENDENCY_HEADERS "${DEPS}/ReactNativeDependenciesHeaders.xcframework/${APPLE_DEPENDENCY_SLICE}/Headers")
set(RN_DEPENDENCY_LIBRARY "${DEPS}/ReactNativeDependencies.xcframework/${APPLE_DEPENDENCY_SLICE}/ReactNativeDependencies.framework/ReactNativeDependencies")
foreach(DEPENDENCY IN ITEMS "${RN_DEPENDENCY_HEADERS}" "${RN_DEPENDENCY_LIBRARY}" "${HERMES_LIBRARY}")
  if(NOT EXISTS "${DEPENDENCY}")
    message(FATAL_ERROR "Missing pinned dependency for ${APPLE_DEPENDENCY_SLICE}: ${DEPENDENCY}")
  endif()
endforeach()

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
  react/nativemodule/core/ReactCommon react/nativemodule/dom
  react/nativemodule/featureflags react/bridging
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
  "${RN}/react/nativemodule/core"
  "${RN}/../React/FBReactNativeSpec"
  "${RN}/react/renderer/components/view/platform/cxx"
  "${RN}/react/renderer/components/scrollview/platform/cxx"
  "${RN}/react/renderer/components/text/platform/cxx"
  "${RN}/react/renderer/textlayoutmanager/platform/cxx"
  "${RN}/react/renderer/graphics/platform/cxx"
  "${RN}/react/utils/platform/cxx"
  "${RN}/runtimeexecutor/platform/cxx"
  "${RN}/react/runtime/nativeviewconfig/platform/cxx"
  "${HERMES}/include"
  "${RN_DEPENDENCY_HEADERS}")
target_link_libraries(fabric_core PUBLIC
  "${RN_DEPENDENCY_LIBRARY}" "${HERMES_LIBRARY}")
add_executable(fabric_smoke smoke.cpp)
target_link_libraries(fabric_smoke PRIVATE fabric_core)
add_executable(timer_registry_test timer_registry_test.cpp)
target_include_directories(timer_registry_test PRIVATE "${RN}")

set(GODOTCPP_TARGET template_release CACHE STRING "Godot binding build configuration")
set(GODOTCPP_BUILD_PROFILE "${CMAKE_CURRENT_SOURCE_DIR}/godot-profile.json" CACHE FILEPATH "" FORCE)
add_subdirectory("../.deps/godot-cpp-da26c1732ee8656ef9ccad587cbdd55acf8637c8" godot-cpp)
if(CMAKE_SYSTEM_NAME STREQUAL "iOS")
  set(FABRIC_GODOT_LIBRARY_TYPE STATIC)
else()
  set(FABRIC_GODOT_LIBRARY_TYPE SHARED)
endif()
add_library(fabric_godot ${FABRIC_GODOT_LIBRARY_TYPE} fabric_application.cpp application_runtime.cpp fabric_surface.cpp text_layout.cpp paragraph_layout.cpp paragraph_view.cpp input_adapter.cpp pointer_adapter.cpp svg_node.cpp scroll_adapter.cpp appearance_adapter.cpp turbo_module_registry.cpp game_service_registry.cpp godot_dom.cpp register.cpp)
target_link_libraries(fabric_godot PRIVATE fabric_core godot-cpp)
if(CMAKE_SYSTEM_NAME STREQUAL "iOS")
  # A static GDExtension links into the exported Xcode app. Its upstream Hermes
  # and RN dependencies remain dynamic frameworks and must be embedded/signed.
  add_executable(fabric_ios_link_smoke smoke.cpp)
  target_link_libraries(fabric_ios_link_smoke PRIVATE fabric_godot fabric_core)
  target_link_options(fabric_ios_link_smoke PRIVATE "-Wl,-u,_fabric_library_init")
  set_target_properties(fabric_smoke fabric_ios_link_smoke timer_registry_test
    PROPERTIES MACOSX_BUNDLE FALSE)
else()
  set_target_properties(fabric_godot PROPERTIES
    PREFIX "" SUFFIX ".dylib"
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/../addons"
    BUILD_WITH_INSTALL_RPATH TRUE
    INSTALL_RPATH "@loader_path/frameworks")
endif()
