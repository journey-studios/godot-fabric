cmake_minimum_required(VERSION 3.31)
project(godot_fabric LANGUAGES C CXX)
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
string(JSON WSLAY_DIRECTORY GET "${FABRIC_DEPENDENCIES_JSON}" wslay directory)
set(WSLAY "${CMAKE_CURRENT_SOURCE_DIR}/../.deps/${WSLAY_DIRECTORY}")
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
  # RN's own Image shadow node, props, state and events, and its image request /
  # observer lifecycle; the host supplies the ImageManager (godot_image_manager.h).
  react/renderer/components/image react/renderer/imagemanager
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
  reactperflogger/reactperflogger jserrorhandler logger oscompat
  # RN's C++ NativeAnimated backend. Its provider also links the legacy-path
  # Scheduler symbols, which the shared AnimationBackend path never calls.
  react/renderer/animated react/renderer/animated/drivers
  react/renderer/animated/event_drivers react/renderer/animated/internal
  react/renderer/animated/nodes react/renderer/scheduler
  # RN's own LayoutAnimation engine (LayoutAnimationDriver and its keyframe manager).
  react/renderer/animations)
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
# Godot's own platform TextLayoutManager replaces RN's portable `cxx` one, header
# and source together: it adds the virtual measureLines behind onTextLayout and
# the Yoga baseline (see text_platform/).
list(APPEND SOURCES "${CMAKE_CURRENT_SOURCE_DIR}/text_platform/react/renderer/textlayoutmanager/TextLayoutManager.cpp")
# The portable ImageManager (a stub that RN's other platforms replace) and its
# ImageRequestParams. The stub includes its header by a bare name, which the
# platform directory does not hold, so only that source sees the base directory.
set(IMAGE_MANAGER_STUB "${RN}/react/renderer/imagemanager/platform/cxx/react/renderer/imagemanager/ImageManager.cpp")
list(APPEND SOURCES "${IMAGE_MANAGER_STUB}")
set_source_files_properties("${IMAGE_MANAGER_STUB}" PROPERTIES INCLUDE_DIRECTORIES "${RN}/react/renderer/imagemanager")
list(APPEND SOURCES
  "${RN}/react/renderer/components/modal/ModalHostViewShadowNode.cpp"
  "${RN}/react/renderer/components/modal/platform/cxx/ModalHostViewUtils.cpp")
# RN's generated core-component Props/EventEmitters/ShadowNodes (the package's
# codegen output). The host registers only the shared non-Android Switch and
# the generated ActivityIndicatorView descriptors.
set(RN_SPECS "${RN}/../React/FBReactNativeSpec/react/renderer/components/FBReactNativeSpec")
list(APPEND SOURCES "${RN_SPECS}/Props.cpp" "${RN_SPECS}/EventEmitters.cpp" "${RN_SPECS}/ShadowNodes.cpp")
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
  "${RN}/react/renderer/components/modal/platform/cxx"
  "${RN}/react/renderer/components/switch/iosswitch"
  "${CMAKE_CURRENT_SOURCE_DIR}/text_platform"
  "${RN}/react/renderer/graphics/platform/cxx"
  "${RN}/react/renderer/imagemanager/platform/cxx"
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
add_executable(frame_clock_test frame_clock_test.cpp)
# The pure performance accounting (series, percentiles, the phases of a pump) needs neither Godot nor RN.
add_executable(performance_metrics_test performance_metrics_test.cpp)
add_executable(affine_transform_test affine_transform_test.cpp)
# The pure HTTP core (URLs, redirects, charsets, base64, multipart) and the blob store need neither Godot nor RN.
add_executable(http_core_test http_core_test.cpp)
# The pure image support (source URIs, format sniffing, header sizes, decode targets and the resize-mode geometry) needs neither Godot nor RN.
add_executable(image_core_test image_core_test.cpp)
# The pure effects of an Image (the blur, the clip of rounded corners, the nine-patch of capInsets and the single description of a draw) too.
add_executable(image_effects_test image_effects_test.cpp)
# The image caches (HTTP freshness, the decoded-image cache's key and the LRU store) are as pure; the network half of the loader needs
# no Godot either, and runs here over a transport of its own.
add_executable(image_cache_test image_cache_test.cpp)
add_executable(image_network_test image_network_test.cpp image_network.cpp)
target_link_libraries(image_network_test PRIVATE fabric_core)
# The pure accessibility core (RN's roles to the roles an OS assistive technology is given) needs neither Godot nor RN.
add_executable(accessibility_core_test accessibility_core_test.cpp)
# The pure WebSocket core (the URL, origin, protocols, headers and close parameters OkHttp accepts) needs neither Godot nor RN.
add_executable(websocket_core_test websocket_core_test.cpp)
add_executable(websocket_handshake_test websocket_handshake_test.cpp)
# The pure device-services core (URL rules, launch arguments, backend seam) needs neither Godot nor RN.
add_executable(device_services_core_test device_services_core_test.cpp)
# The pure AccessibilityInfo core (readings, change rules, names and error codes) needs neither Godot nor RN.
add_executable(accessibility_info_core_test accessibility_info_core_test.cpp)
# The pure announcement core (when an announcement is kept, published, dropped or refused, and what it asks of the platform).
add_executable(accessibility_announcement_core_test accessibility_announcement_core_test.cpp)
target_include_directories(timer_registry_test PRIVATE "${RN}")

# Pin the same upstream wslay implementation used by Godot, without building or
# patching the engine. Only its portable event/framing library enters the addon.
set(WSLAY_STATIC ON CACHE BOOL "Build static wslay" FORCE)
set(WSLAY_SHARED OFF CACHE BOOL "Build shared wslay" FORCE)
set(WSLAY_CONFIGURE_INSTALL OFF CACHE BOOL "Do not install wslay" FORCE)
add_subdirectory("${WSLAY}/lib" wslay)

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
add_library(fabric_godot ${FABRIC_GODOT_LIBRARY_TYPE} fabric_application.cpp application_runtime.cpp fabric_surface.cpp text_layout.cpp paragraph_layout.cpp paragraph_view.cpp switch_view.cpp activity_indicator_view.cpp accessible_view.cpp image_view.cpp image_effects.cpp image_loader.cpp image_network.cpp image_sources.cpp godot_image_manager.cpp image_loader_module.cpp input_adapter.cpp pointer_adapter.cpp pointer_geometry.cpp physical_embedding.cpp svg_node.cpp scroll_adapter.cpp appearance_adapter.cpp transform_adapter.cpp native_animated.cpp turbo_module_registry.cpp networking_modules.cpp websocket_module.cpp device_services.cpp godot_device_backend.cpp godot_http_transport.cpp godot_websocket_transport.cpp godot_websocket_connection.cpp game_service_registry.cpp godot_dom.cpp adapter_registry.cpp adapter_loader.cpp modal_window_stack.cpp modal_presentation.cpp register.cpp)
target_include_directories(fabric_godot PRIVATE "${WSLAY}/lib/includes" "${CMAKE_CURRENT_BINARY_DIR}/wslay/includes")
# AccessibilityInfo: the AccessibilityManager module over the DisplayServer's accessibility settings, and the announcer's port
# into Godot's AccessibilityServer.
target_sources(fabric_godot PRIVATE accessibility_info.cpp accessibility_announcer.cpp)
# LayoutAnimation: RN's LayoutAnimationDriver over the application's frame clock.
target_sources(fabric_godot PRIVATE layout_animation.cpp)

# Explicit test-only extension for synchronous listener reentrancy. Its class is
# registered only in this library; the shipped Fabric extension has no probe API.
option(FABRIC_BUILD_WEBSOCKET_TRANSPORT_TEST "Build the isolated WebSocket transport test extension" OFF)
if(FABRIC_BUILD_WEBSOCKET_TRANSPORT_TEST AND NOT CMAKE_SYSTEM_NAME STREQUAL "iOS")
  add_library(websocket_transport_test SHARED websocket_transport_test_fixture.cpp
    godot_websocket_transport.cpp godot_websocket_connection.cpp)
  target_include_directories(websocket_transport_test PRIVATE "${WSLAY}/lib/includes" "${CMAKE_CURRENT_BINARY_DIR}/wslay/includes")
  target_link_libraries(websocket_transport_test PRIVATE fabric_core "$<LINK_ONLY:wslay>" godot-cpp)
  set_target_properties(websocket_transport_test PROPERTIES PREFIX "" SUFFIX ".dylib"
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/websocket-transport-test")
endif()
if(APPLE AND NOT CMAKE_SYSTEM_NAME STREQUAL "iOS")
  # Retain the binding objects for the pinned Godot class profile as SDK exports,
  # including classes only an external adapter uses. This is one archive in one
  # shared host; adapters never link that archive themselves. Upstream RN sources
  # retain their existing link selection; strict adapter linking identifies any
  # additional RN export required by the supported SPI.
target_link_libraries(fabric_godot PRIVATE fabric_core "$<LINK_ONLY:wslay>" "$<LINK_LIBRARY:WHOLE_ARCHIVE,godot-cpp>")
else()
target_link_libraries(fabric_godot PRIVATE fabric_core "$<LINK_ONLY:wslay>" godot-cpp)
endif()
if(CMAKE_SYSTEM_NAME STREQUAL "iOS")
  # A static GDExtension links into the exported Xcode app. Its upstream Hermes
  # and RN dependencies remain dynamic frameworks and must be embedded/signed.
  add_executable(fabric_ios_link_smoke smoke.cpp)
  target_link_libraries(fabric_ios_link_smoke PRIVATE fabric_godot fabric_core)
  target_link_options(fabric_ios_link_smoke PRIVATE "-Wl,-u,_fabric_library_init")
  set_target_properties(fabric_smoke fabric_ios_link_smoke timer_registry_test frame_clock_test performance_metrics_test affine_transform_test http_core_test image_core_test image_effects_test image_cache_test image_network_test accessibility_core_test websocket_core_test websocket_handshake_test device_services_core_test accessibility_info_core_test accessibility_announcement_core_test pointer_processor_test pointer_processor_original_negative_test pointer_geometry_test pointer_geometry_original_test pointer_projection_test
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
