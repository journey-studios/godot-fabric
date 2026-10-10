// The retained sabotage of the virtualized-list lane, written once: scripts/virtualized-list-bundle.mjs applies it to its copy of src/ for the "sabotage" lane
// (scripts/scroll-view-list-sabotage.mjs runs that lane) and tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side
// effects, so the test can import it.
//
// The public wrapper stops forwarding onLayout, so a list never learns its viewport length from RN's original ScrollView.
export const SABOTAGES = [
  {name: "onlayout-dropped", file: "src/scroll-view.jsx", find: "  return <OriginalScrollView ref={ref} {...forwarded} />;",
    replace: "  delete forwarded.onLayout;\n  return <OriginalScrollView ref={ref} {...forwarded} />;"},
];
