# A hosted playground from the real render (prototype A)

When I ask for a playground for a component or a motion of THIS repository, do not rewrite the component by hand for Clay's preview. Take it as the app renders it.

The helper is `snapshot.mjs` in `KIT_DIR` (the path is at the end of this file). It reads the RUNNING app and writes the element's static markup and only the compiled CSS that applies to it (hover, focus, disabled and dark rules, theme variables, keyframes).

1. Read the real component and find a page of the app where it renders without a sign-in. Start the dev server in the background if none runs.
2. Run `node KIT_DIR/snapshot.mjs --url <page url> --selector '<css or text selector of the element>' --out .clay/snapshot/<id>`. For a dialog or a menu, open it first with `--click '<selector of its trigger>'`. Read `snapshot.json`: the sizes, the fonts of the page, what is not carried.
3. Call `kit_reference`, then `create_playground` with `view.type "preview"`: `view.html` is `snapshot.html` (keep its classes and its wrapper), `view.css` is `snapshot.css` followed by your few lines that bind the controls. Clay's limits are 20,000 characters each for html and css: snapshot one component, not a page; if it is larger, snapshot a smaller element.
4. Controls: 3 to 6, each one thing I asked about. Bind them through CSS on top of the snapshot: a custom property or a declaration with `{{control_id}}` that overrides the real class (same selector plus `.clay-root`, so it wins), or `clay.values` in `view.js` to switch a class or an attribute that the snapshot CSS already has (`data-variant`, `disabled`, `.dark` on the wrapper). `initial` is the value the real CSS has now. Show the states side by side when I ask about states: repeat the markup with the state forced (`disabled`, a class that copies the `:hover` declarations).
5. Outputs are in the project's own form: Tailwind classes or props, not raw CSS. Map each value to the class the project would use (`px-3`, `h-9`, `rounded-lg`, a token), and say so in the output.
6. Tell me in one line what the preview cannot show (the web font, behaviour). Give me the URL. When I say I am done, call `read_playground` and write the outputs into the real file; run the project's typecheck for it.

A whole page does not fit: build it inside the app instead, or snapshot its parts.
