// Simple deploy script: pushes dist/ to the gh-pages branch
import { execSync } from 'child_process'
import { mkdirSync, cpSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const remote = execSync('git remote get-url origin').toString().trim()
const tmp = join(tmpdir(), 'witchdance-deploy-' + Date.now())

console.log('Deploying to gh-pages branch...')
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp)
cpSync('dist', tmp, { recursive: true })

execSync('git init', { cwd: tmp, stdio: 'inherit' })
execSync('git checkout -b gh-pages', { cwd: tmp, stdio: 'inherit' })
execSync('git add -A', { cwd: tmp, stdio: 'inherit' })
execSync('git commit -m "Deploy WitchDance to GitHub Pages"', { cwd: tmp, stdio: 'inherit' })
execSync(`git remote add origin ${remote}`, { cwd: tmp, stdio: 'inherit' })
execSync('git push -f origin gh-pages', { cwd: tmp, stdio: 'inherit' })

rmSync(tmp, { recursive: true, force: true })
console.log('✓ Deployed to https://millermark.github.io/WitchDance/')
