// The retained sabotages of scripts/images-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
export const SABOTAGES = [
  {name: "main-thread", argument: "--sabotage=main-thread", hostDirectory: "build/images-sabotage-main-thread-host",
    file: "native/image_loader.cpp",
    find: '      job->task = WorkerThreadPool::get_singleton()->add_native_task(&State::run_task, arguments, false, "Godot Fabric image load");',
    replace: "      State::run_task(arguments);"},
  {name: "stale-request", argument: "--sabotage=stale-request", hostDirectory: "build/images-sabotage-stale-request-host",
    file: "native/image_view.cpp",
    find: "  if (state_) state_->getData().getImageRequest().getObserverCoordinator().removeObserver(observer_);\n  state_ = state;",
    replace: "  state_ = state;"},
];
