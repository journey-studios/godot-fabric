# Third-party notices

Godot Fabric uses original upstream dependencies. They retain their own licenses.
The npm lockfile fixes JavaScript dependencies; `dependencies.json` fixes native
source/framework archives and verifies SHA-256 before extraction.

| Dependency | Version / revision | License source |
| --- | --- | --- |
| React | 19.2.3 | [MIT](https://github.com/facebook/react/blob/v19.2.3/LICENSE) |
| React Native / Fabric | 0.87.1 | [MIT](https://github.com/facebook/react-native/blob/v0.87.1/LICENSE) |
| React Native Codegen | 0.87.1 | MIT; original package in the same React Native release |
| Hermes | 250829098.0.17 | [MIT](https://github.com/facebook/hermes/blob/main/LICENSE) |
| Yoga | bundled with React Native 0.87.1 | [MIT](https://github.com/facebook/yoga/blob/main/LICENSE) |
| godot-cpp | da26c1732ee8656ef9ccad587cbdd55acf8637c8 | [MIT](https://github.com/godotengine/godot-cpp/blob/da26c1732ee8656ef9ccad587cbdd55acf8637c8/LICENSE.md) |
| Godot | official 4.7.2, separately installed | [MIT and third-party notices](https://godotengine.org/license/) |
| Private Node.js | 22.23.3, macOS arm64 provisioning | Complete LICENSE in the downloaded official Node archive, including third-party notices |
| NativeWind | 4.2.7 | See the installed package LICENSE |
| react-native-css-interop | 0.2.7 | See the installed package LICENSE |
| Tailwind CSS | 3.4.17 | See the installed package LICENSE |
| React Native Chart Kit | 7.0.4 | See the installed package LICENSE |
| Zustand | 5.0.15 | MIT; see the installed package LICENSE |
| Noto Sans / JetBrains Mono | pinned original assets | [SIL OFL 1.1 and asset provenance](assets/fonts/README.md) |

Bundled fonts include their complete license texts alongside the assets.
No third-party framework binaries or vendored upstream source trees are committed.
Setup obtains them from the URLs recorded in the native dependency lock.
ReactNativeDependencies includes additional upstream libraries; its downloaded
artifact and upstream React Native sources retain their associated notices.

Provisioned addon directories include the Node distribution and its license,
the installed JavaScript packages with their license files, native Hermes,
React Native and godot-cpp licenses, font licenses and this notice. They are
generated locally or by CI; no prebuilt public addon release is shipped yet.
