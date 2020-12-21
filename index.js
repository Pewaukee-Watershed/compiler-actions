const core = require('@actions/core')
const glob = require('@actions/glob')
const github = require('@actions/github')
const babel = require('@babel/core')
const types = require('@babel/types')
const { default: generate } = require('@babel/generator')
const React = require('react')
const ReactDOM = require('react-dom/server.js')
const postCss = require('postcss')
const postCssModules = require('postcss-modules')
const fs = require('fs').promises
const path = require('path')

console.log('Finding Files')
console.time('transform');
(async () => {
  const cwd = process.cwd()
  const reactPath = require.resolve('react')
  
  const createBlob = async text => await octokit.git.createBlob({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    content: text,
    encoding: 'utf-8'
  })
  
  const octokit = github.getOctokit(core.getInput('token'))
  
  const reactPreset = babel.createConfigItem(require('@babel/preset-react'), { type: 'preset' })
  const commonjsPlugin = babel.createConfigItem(require('@babel/plugin-transform-modules-commonjs'), { type: 'plugin' })
  
  const noNodeModules = '!**/node_modules'
  
  const cssGlobber = await glob.create(`**/*.css\n${noNodeModules}`)
  const cssFiles = await cssGlobber.glob()
  const cssBlobs = await Promise.all(cssFiles.map(async file => {
    const inputCss = await fs.readFile(file, 'utf8')
    let json
    const { css } = await postCss([postCssModules({
      getJSON(cssFileName, j){
        json = j
      }
    })]).process(inputCss)
    const fileName = path.basename(file, '.css')
    const fileDir = path.dirname(file)
    const cssPath = path.join(fileDir, `${fileName}--css-module.css`)
    await fs.writeFile(cssPath, css)
    const cssBlob = await createBlob(css)
    const jsPath = path.join(fileDir, `${fileName}--css-module.js`)
    const ast = types.ObjectExpression(Object.entries(json).map(([k, v]) => types.ObjectProperty(
        types.Identifier(k),
        types.StringLiteral(v)
      )))
    const esmAst = types.Program([types.ExportDefaultDeclaration(ast)])
    const { code } = generate(esmAst)
    await fs.writeFile(jsPath, code)
    const requirePath = path.join(fileDir, `${fileName}--css-module.cjs`)
    const cjsAst = types.Program([types.ExpressionStatement(types.assignmentExpression(
      '=',
      types.memberExpression(types.Identifier('module'), types.Identifier('exports')),
      ast
    ))])
    const { code: requireCode } = generate(cjsAst)
    console.log(requireCode)
    await fs.writeFile(requirePath, requireCode)
    const jsBlob = await createBlob(code)
    return {
      css: {
        file: path.relative(cwd, cssPath),
        sha: cssBlob.data.sha
      },
      js: {
        file: path.relative(cwd, jsPath),
        sha: jsBlob.data.sha
      }
    }
  }))
  
  const jsGlobber = await glob.create(`**/*.jsx\n${noNodeModules}`)
  const jsFiles = await jsGlobber.glob()
  
  const renderFile = `
import(\`./\${import.meta.url
  .split('?')[1]
  .split('&')
  .map(p => p.split('='))
  .find(([p]) => p === 'component')[1]}\`
).then(({ default: App }) => {
  const app = React.createElement(App)
  const appDiv = document.getElementById('app')
  ReactDOM.hydrate(app, appDiv)
})
`
  const renderBlob = await createBlob(renderFile)
  
  const jsBlobs = await Promise.all(jsFiles.map(async file => {
    const text = await fs.readFile(file, 'utf8')
    const jsFile = file.replace('.jsx', '.js')
    const jsDir = path.dirname(jsFile)
    const cssSources = []
    const { code, ast } = await babel.transformAsync(text, {
      plugins: [{
        visitor: {
          ImportDeclaration(p){
            if(p.node.source.value.endsWith('.css')){
              const cssFile = path.join(jsDir, p.node.source.value)
              if(cssFile.startsWith(cwd)){
                p.node.source.value = p.node.source.value.split('.css')[0] + '--css-module.js'
              }else{
                p.remove()
              }
              cssSources.push(p.node.source.value)
            }
          }
        }
      }],
      presets: [reactPreset],
      ast: true
    })
    const jsBlob = await createBlob(`const React = window.React\n${code}`)
    const jsPath = path.relative(cwd, jsFile)
    const { code: requireCode } = await babel.transformFromAstAsync(ast, text, {
      plugins: [{
        visitor: {
          ImportDeclaration({ node: { source } }){
            if(source.value.endsWith('--css-module.js')){
              source.value = source.value.replace('--css-module.js', '--css-module.cjs')
            }
          }
        }
      }, commonjsPlugin]
    })
    const relativeReactPath = path.relative(jsDir, reactPath)
    await fs.writeFile(jsFile, `const React = require('${relativeReactPath}')\n${requireCode}`)
    const { default: App } = require(jsFile)
    const app = React.createElement(App)
    const relativeRenderPath = path.relative(jsDir, path.join(cwd, 'render.js'))
    const html = `
<!DOCTYPE html>
<html>
<head>
  <script crossorigin src="https://unpkg.com/react@17/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@17/umd/react-dom.development.js"></script>
  <script type="module" src="${relativeRenderPath}?component=${jsPath}"></script>
  ${cssSources
      .map(source => `<link rel="stylesheet" href="${source}">`)
      .join('\n')}
</head>
<body>
  <div id="app">${ReactDOM.renderToString(app)}</div>
</body>
</html>
`
    const htmlBlob = await createBlob(html)
    const htmlFile = file.replace('.jsx', '.html')
    return {
      js: {
        file: jsPath,
        sha: jsBlob.data.sha
      },
      html: {
        file: path.relative(cwd, htmlFile),
        sha: htmlBlob.data.sha
      }
    }
  }))
  const tree = await octokit.git.createTree({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    tree: [
      {
        path: 'render.js',
        sha: renderBlob.data.sha,
        mode: '100644'
      },
      ...jsBlobs.map(({ js, html }) => [js, html].map(({ file, sha }) => ({
        path: file,
        sha: sha,
        mode: '100644'
      }))),
      ...cssBlobs.map(({ css, js }) => [css, js].map(({ file, sha }) => ({
        path: file,
        sha: sha,
        mode: '100644'
      })))
    ],
    base_tree: github.context.payload.head_commit.tree_id
  })
  const commit = await octokit.git.createCommit({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      message: 'Compile JSX to JS and HTML',
      tree: tree.data.sha,
      parents: [github.context.payload.head_commit.id],
      author: {
          name: 'Compiler Actions',
          email: 'compiler-actions[bot]'
      }
  })
  await octokit.git.updateRef({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      ref: github.context.ref.slice(5),
      sha: commit.data.sha
  })
})()
  .then(() => {
    console.timeEnd('transform')
  })
  .catch(e => {
    core.setFailed(e.stack)
  })
