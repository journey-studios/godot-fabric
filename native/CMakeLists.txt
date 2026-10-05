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
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../dependencies.json" FABRIC_DEPENDENCIES_JSON)
string(JSON FABRIC_NODE_VERSION GET "${FABRIC_DEPENDENCIES_JSON}" node version)
find_program(FABRIC_OVERLAY_NODE NAMES node
  HINTS "${CMAKE_CURRENT_SOURCE_DIR}/../.deps/node-v${FABRIC_NODE_VERSION}-darwin-arm64/bin"
  REQUIRED)
set(FABRIC_POINTER_OVERLAY "${CMAKE_BINARY_DIR}/rn-pointer-overlay")
set(FABRIC_POINTER_OVERLAY_SCRIPT "${CMAKE_CURRENT_SOURCE_DIR}/../scripts/rn-pointer-overlay.mjs")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
  "${FABRIC_POINTER_OVERLAY_SCRIPT}"
  "${RN}/react/renderer/uimanager/PointerEventsProcessor.h"
  "${RN}/react/renderer/uimanager/PointerEventsProcessor.cpp"
  "${RN}/react/renderer/uimanager/UIManagerBinding.h"
  "${RN}/react/renderer/uimanager/UIManagerBinding.cpp")
execute_process(COMMAND "${FABRIC_OVERLAY_NODE}" "${FABRIC_POINTER_OVERLAY_SCRIPT}"
  "${RN}" "${FABRIC_POINTER_OVERLAY}" COMMAND_ERROR_IS_FATAL ANY)
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

# Portable upstream Fabric with a hash-verified pointer lifetime overlay.
# No mobile renderer or modified reconciler is compiled here. Downloaded RN
# sources remain immutable; generated native changes have separate SDK inputs.
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
foreach(OVERLAY_COMPONENT IN ITEMS PointerEventsProcessor UIManagerBinding)
  list(REMOVE_ITEM SOURCES "${RN}/react/renderer/uimanager/${OVERLAY_COMPONENT}.cpp")
  list(APPEND SOURCES "${FABRIC_POINTER_OVERLAY}/react/renderer/uimanager/${OVERLAY_COMPONENT}.cpp")
endforeach()
file(GLOB MOUNT_INTERNAL CONFIGURE_DEPENDS "${RN}/react/renderer/mounting/internal/*.cpp")
file(GLOB_RECURSE YOGA CONFIGURE_DEPENDS "${RN}/yoga/yoga/*.cpp")
list(FILTER YOGA EXCLUDE REGEX "/tests/")
list(APPEND SOURCES ${MOUNT_INTERNAL} ${YOGA})
list(APPEND SOURCES "${RN}/react/renderer/textlayoutmanager/platform/cxx/react/renderer/textlayoutmanager/TextLayoutManager.cpp")
# RN's generated core-component Props/EventEmitters (the package's codegen
# output). The host registers only the shared non-Android Switch descriptor.
set(RN_SPECS "${RN}/../React/FBReactNativeSpec/react/renderer/components/FBReactNativeSpec")
list(APPEND SOURCES "${RN_SPECS}/Props.cpp" "${RN_SPECS}/EventEmitters.cpp")
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
  "${FABRIC_POINTER_OVERLAY}"
  "${RN}" "${RN}/jsi" "${RN}/yoga" "${RN}/callinvoker" "${RN}/runtimeexecutor"
  "${RN}/reactperflogger"
  "${RN}/react/nativemodule/core"
  "${RN}/../React/FBReactNativeSpec"
  "${RN}/react/renderer/components/view/platform/cxx"
  "${RN}/react/renderer/components/scrollview/platform/cxx"
  "${RN}/react/renderer/components/text/platform/cxx"
  "${RN}/react/renderer/components/switch/iosswitch"
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
add_executable(pointer_processor_test pointer_processor_test.cpp)
target_link_libraries(pointer_processor_test PRIVATE fabric_core)
add_executable(pointer_geometry_test pointer_geometry_test.cpp)
target_link_libraries(pointer_geometry_test PRIVATE fabric_core)
add_executable(pointer_projection_test pointer_projection_test.cpp)
target_link_libraries(pointer_projection_test PRIVATE fabric_core)
add_executable(pointer_geometry_original_test EXCLUDE_FROM_ALL
  pointer_geometry_test.cpp
  "${RN}/react/renderer/uimanager/PointerEventsProcessor.cpp"
  "${RN}/react/renderer/uimanager/UIManagerBinding.cpp")
target_include_directories(pointer_geometry_original_test BEFORE PRIVATE "${RN}")
target_compile_definitions(pointer_geometry_original_test PRIVATE GODOT_FABRIC_POINTER_GEOMETRY_ORIGINAL=1)
target_link_libraries(pointer_geometry_original_test PRIVATE fabric_core)
# Isolated expected-failure control: compile the unchanged downloaded processor
# against its original header. It is never shipped or part of an ordinary build.
add_executable(pointer_processor_original_negative_test EXCLUDE_FROM_ALL
  pointer_processor_test.cpp
  "${RN}/react/renderer/uimanager/PointerEventsProcessor.cpp"
  "${RN}/react/renderer/uimanager/UIManagerBinding.cpp")
target_include_directories(pointer_processor_original_negative_test BEFORE PRIVATE "${RN}")
target_compile_definitions(pointer_processor_original_negative_test PRIVATE GODOT_FABRIC_POINTER_ORIGINAL_NEGATIVE=1)
target_link_libraries(pointer_processor_original_negative_test PRIVATE fabric_core)
add_executable(timer_registry_test timer_registry_test.cpp)
add_executable(affine_transform_test affine_transform_test.cpp)
target_include_directories(timer_registry_test PRIVATE "${RN}")

set(GODOTCPP_TARGET template_release CACHE STRING "Godot binding build configuration")
set(GODOTCPP_BUILD_PROFILE "${CMAKE_CURRENT_SOURCE_DIR}/godot-profile.json" CACHE FILEPATH "" FORCE)
if(APPLE AND NOT CMAKE_SYSTEM_NAME STREQUAL "iOS")
  # An external adapter imports these same bindings and their initialized global
  # state from the host. A second godot-cpp archive would create another state.
  set(GODOTCPP_SYMBOL_VISIBILITY visible CACHE STRING "Shared native SDK binding visibility" FORCE)
endif()
add_subdirectory("../.deps/godot-cpp-da26c1732ee8656ef9ccad587cbdd55acf8637c8" godot-cpp)
if(CMAKE_SYSTEM_NAME STREQUAL "iOS")
  set(FABRIC_GODOT_LIBRARY_TYPE STATIC)
else()
  set(FABRIC_GODOT_LIBRARY_TYPE SHARED)
endif()
add_library(fabric_godot ${FABRIC_GODOT_LIBRARY_TYPE} fabric_application.cpp application_runtime.cpp fabric_surface.cpp text_layout.cpp paragraph_layout.cpp paragraph_view.cpp switch_view.cpp input_adapter.cpp pointer_adapter.cpp pointer_geometry.cpp svg_node.cpp scroll_adapter.cpp appearance_adapter.cpp transform_adapter.cpp turbo_module_registry.cpp game_service_registry.cpp godot_dom.cpp adapter_registry.cpp adapter_loader.cpp register.cpp)
if(APPLE AND NOT CMAKE_SYSTEM_NAME STREQUAL "iOS")
  # Retain the binding objects for the pinned Godot class profile as SDK exports,
  # including classes only an external adapter uses. This is one archive in one
  # shared host; adapters never link that archive themselves. Upstream RN sources
  # retain their existing link selection; strict adapter linking identifies any
  # additional RN export required by the supported SPI.
  target_link_libraries(fabric_godot PRIVATE fabric_core "$<LINK_LIBRARY:WHOLE_ARCHIVE,godot-cpp>")
else()
  target_link_libraries(fabric_godot PRIVATE fabric_core godot-cpp)
endif()
if(CMAKE_SYSTEM_NAME STREQUAL "iOS")
  # A static GDExtension links into the exported Xcode app. Its upstream Hermes
  # and RN dependencies remain dynamic frameworks and must be embedded/signed.
  add_executable(fabric_ios_link_smoke smoke.cpp)
  target_link_libraries(fabric_ios_link_smoke PRIVATE fabric_godot fabric_core)
  target_link_options(fabric_ios_link_smoke PRIVATE "-Wl,-u,_fabric_library_init")
  set_target_properties(fabric_smoke fabric_ios_link_smoke timer_registry_test affine_transform_test pointer_processor_test pointer_processor_original_negative_test pointer_geometry_test pointer_geometry_original_test pointer_projection_test
    PROPERTIES MACOSX_BUNDLE FALSE)
else()
  set_target_properties(fabric_godot PROPERTIES
    PREFIX "" SUFFIX ".dylib"
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/../addons"
    BUILD_WITH_INSTALL_RPATH TRUE
    INSTALL_RPATH "@loader_path/frameworks")
  if(APPLE AND CMAKE_BUILD_TYPE STREQUAL "Release" AND CMAKE_OSX_ARCHITECTURES STREQUAL "arm64"
      AND CMAKE_GENERATOR STREQUAL "Unix Makefiles")
    # Build tools may supply an explicit Node on CI; local private Node is merely
    # a preferred search location. No dependency is downloaded by these hooks.
    file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../dependencies.json" FABRIC_DEPENDENCIES_JSON)
    string(JSON FABRIC_NODE_VERSION GET "${FABRIC_DEPENDENCIES_JSON}" node version)
    find_program(FABRIC_SDK_NODE NAMES node
      HINTS "${CMAKE_CURRENT_SOURCE_DIR}/../.deps/node-v${FABRIC_NODE_VERSION}-darwin-arm64/bin"
      REQUIRED)
    set(FABRIC_SDK_INPUTS "${CMAKE_BINARY_DIR}/native-sdk-inputs.json")
    add_custom_target(fabric_sdk_capture
      COMMAND "${FABRIC_SDK_NODE}" "${CMAKE_CURRENT_SOURCE_DIR}/../scripts/native-sdk.mjs" capture
        --build-dir "${CMAKE_BINARY_DIR}"
      BYPRODUCTS "${FABRIC_SDK_INPUTS}"
      VERBATIM)
    # PRE_BUILD is PRE_LINK with Make/Ninja. Explicit dependencies instead capture
    # inputs before either archive compiles, after generated headers are ready.
    add_dependencies(fabric_sdk_capture generate_bindings)
    add_dependencies(fabric_core fabric_sdk_capture)
    add_dependencies(godot-cpp fabric_sdk_capture)
    add_dependencies(fabric_godot fabric_sdk_capture)
    set_property(TARGET fabric_godot APPEND PROPERTY LINK_DEPENDS "${FABRIC_SDK_INPUTS}")
    add_custom_command(TARGET fabric_godot POST_BUILD
      COMMAND "${FABRIC_SDK_NODE}" "${CMAKE_CURRENT_SOURCE_DIR}/../scripts/native-sdk.mjs" record
        --build-dir "${CMAKE_BINARY_DIR}" --host "$<TARGET_FILE:fabric_godot>"
      VERBATIM)
  endif()
endif()
