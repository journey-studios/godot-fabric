#pragma once

#include <ReactCommon/CallInvoker.h>
#include <jsi/jsi.h>
#include <memory>
#include <utility>

namespace fabric_godot {
// A CallInvoker that runs nothing once its owner has stopped, so that queued
// events and promise settlements cannot outlive the application. RN's own
// callbacks keep calling through it unchanged.
//
// State is whatever the owner shares with the modules. It must provide
//   bool accepts_calls() const   false from the moment the owner stops
//   void drop_call()             counts one queued call that was not run
// The invoker holds the state weakly: a call that outlives the owner is
// silently ignored.
template <typename State>
class StoppableInvoker final : public facebook::react::CallInvoker {
 public:
  StoppableInvoker(std::shared_ptr<facebook::react::CallInvoker> delegate, std::weak_ptr<State> owner)
      : delegate_(std::move(delegate)), owner_(std::move(owner)) {}
  void invokeAsync(facebook::react::CallFunc &&function) noexcept override {
    delegate_->invokeAsync(guard(std::move(function)));
  }
  void invokeAsync(facebook::react::SchedulerPriority priority, facebook::react::CallFunc &&function) noexcept override {
    delegate_->invokeAsync(priority, guard(std::move(function)));
  }
  void invokeSync(facebook::react::CallFunc &&function) override { delegate_->invokeSync(guard(std::move(function))); }

 private:
  std::shared_ptr<facebook::react::CallInvoker> delegate_;
  std::weak_ptr<State> owner_;
  facebook::react::CallFunc guard(facebook::react::CallFunc &&function) const {
    return [owner = owner_, function = std::move(function)](facebook::jsi::Runtime &runtime) {
      auto state = owner.lock();
      if (!state) {
        return;
      }
      if (state->accepts_calls()) {
        function(runtime);
      } else {
        state->drop_call();
      }
    };
  }
};
}
