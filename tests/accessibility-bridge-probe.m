// An NSAccessibility inspector that lives inside a running graphical Godot.
//
// Godot's official macOS build allows dyld environment variables and unsigned libraries, so
// DYLD_INSERT_LIBRARIES loads this library into the process. It reads the accessibility tree the window's
// content view serves to the system (AccessKitSubclassOfGodotContentView and its AccessKitNode children,
// the objects a screen reader talks to), and presses elements with accessibilityPerformPress, the call
// behind AXPress. An external AXUIElement client would need the TCC permission; code inside the process
// needs none.
//
// It answers requests that the test writes to FABRIC_AX_DIR/request.json and replies in response.json. A
// timer on the main queue polls for requests: Godot's loop services the main queue, and AccessKit's tree is
// only read from there. The first query of the tree activates AccessKit's adapter, so a query can come back
// empty; the caller asks again until the state it waits for shows (by frames, never by a fixed time).
//
//   {"id": 1, "op": "dump"}                               -> {"id": 1, "tree": <node>}
//   {"id": 2, "op": "press", "title": "Save", "role": "AXButton", "occurrence": 0}
//                                                         -> {"id": 2, "matched": 2, "pressed": true}
//
// A node is {role, subrole, roleDescription, title, help, value, enabled, selected, children}.
#import <AppKit/AppKit.h>
#import <objc/message.h>
#import <objc/runtime.h>

static NSString *directory;

static id value(id object, SEL selector) {
  if (![object respondsToSelector:selector]) {
    return nil;
  }
  return ((id (*)(id, SEL))objc_msgSend)(object, selector);
}
static BOOL flag(id object, SEL selector) {
  if (![object respondsToSelector:selector]) {
    return NO;
  }
  return ((BOOL (*)(id, SEL))objc_msgSend)(object, selector);
}
static id jsonSafe(id candidate) {
  if (candidate == nil) {
    return [NSNull null];
  }
  if ([candidate isKindOfClass:[NSNumber class]] || [candidate isKindOfClass:[NSString class]]) {
    return candidate;
  }
  return [candidate description];
}
static NSArray *childrenOf(id node) {
  id children = value(node, @selector(accessibilityChildren));
  return [children isKindOfClass:[NSArray class]] ? children : @[];
}
static NSDictionary *describe(id node, int depth) {
  NSMutableArray *children = [NSMutableArray array];
  if (depth < 16) {
    for (id child in childrenOf(node)) {
      [children addObject:describe(child, depth + 1)];
    }
  }
  return @{
    @"role": jsonSafe(value(node, @selector(accessibilityRole))),
    @"subrole": jsonSafe(value(node, @selector(accessibilitySubrole))),
    @"roleDescription": jsonSafe(value(node, @selector(accessibilityRoleDescription))),
    @"title": jsonSafe(value(node, @selector(accessibilityTitle))),
    @"help": jsonSafe(value(node, @selector(accessibilityHelp))),
    @"value": jsonSafe(value(node, @selector(accessibilityValue))),
    @"enabled": @(flag(node, @selector(isAccessibilityEnabled))),
    @"selected": @(flag(node, @selector(isAccessibilitySelected))),
    @"children": children,
  };
}
// The content view the window serves its accessibility tree from.
static id contentRoot(void) {
  for (NSWindow *window in NSApp.windows) {
    if (strstr(object_getClassName(window.contentView), "AccessKit") != NULL) {
      return window.contentView;
    }
  }
  return nil;
}
static void collect(id node, NSString *title, NSString *role, NSMutableArray *matches, int depth) {
  if (depth > 16) {
    return;
  }
  NSString *nodeTitle = value(node, @selector(accessibilityTitle));
  NSString *nodeRole = value(node, @selector(accessibilityRole));
  if ([nodeTitle isKindOfClass:[NSString class]] && [nodeTitle isEqualToString:title] &&
      (role == nil || [nodeRole isEqualToString:role])) {
    [matches addObject:node];
  }
  for (id child in childrenOf(node)) {
    collect(child, title, role, matches, depth + 1);
  }
}
static NSDictionary *answer(NSDictionary *request) {
  NSString *operation = request[@"op"];
  id root = contentRoot();
  if (root == nil) {
    return @{@"id": request[@"id"], @"error": @"no window serves an AccessKit tree yet"};
  }
  if ([operation isEqualToString:@"dump"]) {
    return @{@"id": request[@"id"], @"tree": describe(root, 0)};
  }
  if ([operation isEqualToString:@"press"]) {
    NSMutableArray *matches = [NSMutableArray array];
    collect(root, request[@"title"], request[@"role"], matches, 0);
    NSInteger occurrence = [request[@"occurrence"] integerValue];
    BOOL pressed = NO;
    if ((NSInteger)matches.count > occurrence) {
      pressed = ((BOOL (*)(id, SEL))objc_msgSend)(matches[occurrence], @selector(accessibilityPerformPress));
    }
    return @{@"id": request[@"id"], @"matched": @(matches.count), @"pressed": @(pressed)};
  }
  return @{@"id": request[@"id"], @"error": [@"unknown operation " stringByAppendingString:operation ?: @""]};
}
static void poll(void) {
  NSString *requestPath = [directory stringByAppendingPathComponent:@"request.json"];
  NSData *data = [NSData dataWithContentsOfFile:requestPath];
  if (data == nil) {
    return;
  }
  NSDictionary *request = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  // The test may still be writing the file: read it again at the next tick.
  if (![request isKindOfClass:[NSDictionary class]] || request[@"id"] == nil) {
    return;
  }
  [[NSFileManager defaultManager] removeItemAtPath:requestPath error:nil];
  NSData *response = [NSJSONSerialization dataWithJSONObject:answer(request) options:0 error:nil];
  [response writeToFile:[directory stringByAppendingPathComponent:@"response.json"] atomically:YES];
}

__attribute__((constructor)) static void start(void) {
  const char *configured = getenv("FABRIC_AX_DIR");
  if (configured == NULL) {
    return;
  }
  directory = [NSString stringWithUTF8String:configured];
  dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
  dispatch_source_set_timer(timer, DISPATCH_TIME_NOW, 5 * NSEC_PER_MSEC, NSEC_PER_MSEC);
  dispatch_source_set_event_handler(timer, ^{ poll(); });
  dispatch_resume(timer);
  // The source lives as long as the process.
  static dispatch_source_t retained;
  retained = timer;
}
