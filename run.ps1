<#
    run.ps1 — Windows one-command runner for the reproducible pipeline.
    Same targets as the Makefile, but works without `make` installed.
    Requires: Docker Desktop running.

    Usage:
        .\run.ps1 build
        .\run.ps1 verify
        .\run.ps1 test
        .\run.ps1 baselines
        .\run.ps1 train
        .\run.ps1 evaluate
        .\run.ps1 phase7
        .\run.ps1 all
        .\run.ps1 clean
#>
param(
    [Parameter(Position = 0)]
    [ValidateSet('build','verify','test','baselines','network','train','evaluate','phase7','all','clean')]
    [string]$Target = 'all',

    [int]$Episodes = 80,
    [int]$SimTime = 600,
    [int]$EvalSimTime = 1200,
    [string]$Seeds = '1 2 3'
)

$ErrorActionPreference = 'Stop'
$RUN = @('compose','run','--rm','traffic-rl')

function Invoke-Run([string[]]$Cmd) {
    Write-Host ">> docker $($RUN -join ' ') $($Cmd -join ' ')" -ForegroundColor Cyan
    & docker @RUN @Cmd
    if ($LASTEXITCODE -ne 0) { throw "Command failed (exit $LASTEXITCODE)" }
}

function Do-Build   { & docker compose build traffic-rl; if ($LASTEXITCODE -ne 0) { throw 'build failed' } }
function Do-Network { Invoke-Run @('bash','network/build_network.sh') }
function Do-Verify  { Invoke-Run @('python3','verify_sumo.py') }
function Do-Test    { Invoke-Run @('python3','-m','pytest','tests/test_reward.py','tests/test_agent.py','-v') }
function Do-Baselines { Invoke-Run (@('python3','-m','baselines.run_baselines','--max-sim-time',"$EvalSimTime",'--seeds') + $Seeds.Split(' ')) }
function Do-Train {
    foreach ($s in 'balanced','asymmetric','surge') {
        Invoke-Run @('python3','train.py','--scenario',$s,'--episodes',"$Episodes",'--max-sim-time',"$SimTime",'--seed','42')
    }
}
function Do-Evaluate { Invoke-Run (@('python3','evaluate.py','--scenarios','balanced','asymmetric','surge','--seeds') + $Seeds.Split(' ') + @('--max-sim-time',"$EvalSimTime")) }
function Do-Phase7 {
    Invoke-Run @('python3','train.py','--scenario','hetero','--pcu-weighting','--tag','_pcu','--episodes','150','--max-sim-time',"$SimTime",'--seed','42')
    Invoke-Run @('python3','train.py','--scenario','hetero','--tag','_nopcu','--episodes','150','--max-sim-time',"$SimTime",'--seed','42')
    Invoke-Run (@('python3','evaluate_hetero.py','--seeds') + $Seeds.Split(' ') + @('--max-sim-time',"$EvalSimTime"))
}
function Do-Clean {
    Remove-Item -ErrorAction SilentlyContinue agent/models/*.pt, results/logs/*.csv, results/plots/*.png
    Write-Host 'Cleaned generated checkpoints, logs, and plots.'
}

switch ($Target) {
    'build'     { Do-Build }
    'network'   { Do-Network }
    'verify'    { Do-Verify }
    'test'      { Do-Test }
    'baselines' { Do-Baselines }
    'train'     { Do-Train }
    'evaluate'  { Do-Evaluate }
    'phase7'    { Do-Phase7 }
    'clean'     { Do-Clean }
    'all'       { Do-Build; Do-Verify; Do-Test; Do-Baselines; Do-Train; Do-Evaluate; Do-Phase7;
                  Write-Host 'Full pipeline complete. See results/logs/ and results/plots/.' -ForegroundColor Green }
}
