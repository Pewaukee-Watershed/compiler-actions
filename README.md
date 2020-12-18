# compiler-actions
Compile JSX to JS and HTML

## What it does
- Creates a render.js file. This file is for rendering components on the page
- Finds all `.css` files
  - Creates a `--css-module.css` file with the same name. Uses `postcss-modules` to compile this.
  - Creates a `--css-module.js` file with te same name. This file exports the `postcss-modules` transformation object.
- Finds all `.jsx` files
  - Creates a `.js` file with the same name. Uses babel to compile this.
  - Creates a `.html` file with the same name. Uses react dom server rendering to do this.
- Commits changes to the branch it was run on.
  
## Inputs
- token: The repository `secrets.GITHUB_TOKEN`. Used to create commits.
