const core = require('@actions/core')
const glob = require('@actions/glob')
const github = require('@actions/github')
const babel = require('@babel/core')
const React = require('react')
const ReactDOM = require('react-dom/server.js')
const fs = require('fs').promises
const path = require('path')

console.log('Finding Files')
console.time('transform');
(async () => {
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
  
  const globber = await glob.create('**/*.jsx\n!**/node_modules')
  const files = await globber.glob()
  
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
  
  const blobs = await Promise.all(files.map(async file => {
    const text = await fs.readFile(file, 'utf8')
    const { code } = await babel.transformAsync(text, {
      plugins: [{
        visitor: {
         ImportDeclaration(path){
           if(path.node.source.value.endsWith('.css')){
             cssSources.push(path.node.source.value)
             path.remove()
           }
         }
        }
      }],
      presets: [reactPreset]
    })
    const jsBlob = await createBlob(`const React = window.React\n${code}`)
    const jsFile = file.replace('.jsx', '.js')
    const jsPath = path.relative(process.cwd(), jsFile)
    const cssSources = []
    const { code: requireCode } = await babel.transformAsync(text, {
      plugins: [{
        visitor: {
         ImportDeclaration(path){
           console.log(path.node.source.value)
           if(path.node.source.value.endsWith('.css')){
             path.remove()
             console.log('removed path')
           }
         }
        }
      }, commonjsPlugin],
      presets: [reactPreset]
    })
    console.log(requireCode)
    return
    const relativeReactPath = path.relative(path.dirname(jsFile), reactPath)
    await fs.writeFile(jsFile, `const React = require('${relativeReactPath}')\n${requireCode}`)
    const { default: App } = require(jsFile)
    const app = React.createElement(App)
    const html = `
<!DOCTYPE html>
<html>
<head>
  <script crossorigin src="https://unpkg.com/react@17/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@17/umd/react-dom.development.js"></script>
  <script type="module" src="/render.js?component=${jsPath}"></script>
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
        file: path.relative(process.cwd(), htmlFile),
        sha: htmlBlob.data.sha
      }
    }
  }))
  const tree = await octokit.git.createTree({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    tree: [{
      path: 'render.js',
      sha: renderBlob.data.sha,
      mode: '100644'
    }].concat(...blobs.map(({ js, html }) => [js, html].map(({ file, sha }) => ({
      path: file,
      sha: sha,
      mode: '100644'
    })))),
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
