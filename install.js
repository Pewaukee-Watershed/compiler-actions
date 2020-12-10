const { exec } = require('child_process')

const install = exec('npm i', { cwd: __dirname })
    .once('exit', code => {
        process.exit(code)
    })

install.stdout.pipe(process.stdout)
install.stderr.pipe(process.stderr)
