import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import dotenv from 'dotenv'

dotenv.config()

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      ...options,
    })

    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ code })
      } else {
        reject(new Error(`${command} exited with code ${code}`))
      }
    })
    child.on('error', reject)
  })
}

async function main() {
  const outputRoot = path.resolve('outputs')
  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const runDir = path.join(outputRoot, runId)
  const latestDir = path.join(outputRoot, 'latest')

  fs.mkdirSync(runDir, { recursive: true })
  fs.mkdirSync(latestDir, { recursive: true })

  const k6SummarySteadyPath = path.join(runDir, 'k6-summary-steady.json')
  const k6SummaryPeakPath = path.join(runDir, 'k6-summary-peak.json')
  const infraSamplePath = path.join(runDir, 'infra-samples.jsonl')

  const scenarioJson = fs.readFileSync(path.resolve('config/scenario.json'), 'utf8')
  const env = {
    ...process.env,
    K6_SUMMARY_PATH: k6SummarySteadyPath,
    K6_SUMMARY_STEADY_PATH: k6SummarySteadyPath,
    K6_SUMMARY_PEAK_PATH: k6SummaryPeakPath,
    INFRA_SAMPLE_PATH: infraSamplePath,
    BENCH_OUTPUT_DIR: runDir,
    SCENARIO_JSON: scenarioJson,
  }

  let sampler = null

  try {
    sampler = spawn('node', ['scripts/sample-infra.mjs'], {
      env,
      stdio: 'inherit',
      shell: true,
    })

    const k6Bin = String(process.env.K6_BIN || 'k6').trim()

    await run(
      k6Bin,
      [
        'run',
        'k6/janakas-flow.js',
      ],
      {
        env: {
          ...env,
          LOAD_MODE: 'steady',
          K6_SUMMARY_PATH: k6SummarySteadyPath,
        },
      },
    )

    await run(
      k6Bin,
      [
        'run',
        'k6/janakas-flow.js',
      ],
      {
        env: {
          ...env,
          LOAD_MODE: 'peak',
          K6_SUMMARY_PATH: k6SummaryPeakPath,
        },
      },
    )
  } finally {
    if (sampler && !sampler.killed) {
      sampler.kill('SIGINT')
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  await run('node', ['scripts/build-report.mjs'], { env })

  const artifacts = [
    'k6-summary-steady.json',
    'k6-summary-peak.json',
    'infra-samples.jsonl',
    'benchmark-report.json',
    'SUMMARY_REPORT.md',
  ]
  for (const file of artifacts) {
    const source = path.join(runDir, file)
    const target = path.join(latestDir, file)
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, target)
    }
  }

  console.log(`Benchmark completed. Output:\n- ${runDir}\n- ${latestDir}`)
}

main().catch((error) => {
  console.error('Benchmark run failed:', error.message)
  process.exit(1)
})
