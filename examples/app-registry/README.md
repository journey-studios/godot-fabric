# AppRegistry

```sh
npm run example -- app-registry
npm run example -- app-registry --headless
npm run example -- app-registry --capture
npm run test:app-registry
```

RN's original `AppRegistry` through the public `react-native` import. The component registers itself with
`registerComponent` and a second one with `registerSection`, so `getAppKeys` and `getSectionKeys` have something to
list. **Apply wrapper and root style** calls `setWrapperComponentProvider` and `setRootViewStyleProvider` and then runs
the surface again with `setSurfaceProps`: RN's registry calls both providers the next time a root runs, the wrapper's
component goes around the card, and the style goes on the root View, which is a native Godot Control. **Count +1** is
React state. The first run after the wrapper is set puts the wrapper above the card, so React mounts the card again and
its count starts over, as it does in RN; after that the tree keeps its shape, and **Update props**, another
`setSurfaceProps`, changes the props and keeps the count. The
launcher entry is the interactive demo; `npm run test:app-registry` is the
[evidence](../../docs/evidence/app-registry/README.md) suite, outside the catalog.

![The registered card in RN's default root](../../docs/evidence/app-registry/app-registry-before.png)

**Before** is RN's default root: the root View fills the surface, has no background, and nothing wraps the card.

![The card in a wrapper, on a root with the style provider's background, radius and padding](../../docs/evidence/app-registry/app-registry-providers.png)

**With the providers** the root is the indigo rounded View the style provider returned, padded by 16 points, and the frame
the wrapper provider returned surrounds the card and shows the root's `initialProps`.

`unmountApplicationComponentAtRootTag` only logs RN's error, as in RN's Fabric: a root unmounts through
`FabricSurface.unmount()`. `runApplication` and `setSurfaceProps` need a surface the scene mounted, and the four
headless-task members throw `E_APP_REGISTRY_HEADLESS_TASK`; see [the API guide](../../docs/API.md#shared-application-and-root-authoring).
