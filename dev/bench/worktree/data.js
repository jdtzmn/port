window.BENCHMARK_DATA = {
  "lastUpdate": 1789606612175,
  "repoUrl": "https://github.com/jdtzmn/port",
  "entries": {
    "Port worktree operations": [
      {
        "commit": {
          "author": {
            "email": "jdtzmn@gmail.com",
            "name": "Jacob Daitzman",
            "username": "jdtzmn"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "a99ebdb105c429b5eefce0cea46f104f89858f31",
          "message": "Add CI performance benchmarks (#155)\n\n* Add benchmark statistics helpers\n\n* Add deterministic CLI benchmark runner\n\n* Add CI performance benchmarks\n\n* Handle missing benchmark history\n\n* Run benchmark suites in parallel\n\n* Reuse chart history between benchmark reports\n\n* Calibrate large Docker status budget\n\n* Speed up Docker benchmark lifecycle\n\n* Add sticky benchmark PR comment\n\n* Simplify benchmark PR comment\n\n* Limit benchmark comments to alerts",
          "timestamp": "2026-09-12T16:45:19-04:00",
          "tree_id": "18fb862565d56e4705ef2fb146e06bba78f1233f",
          "url": "https://github.com/jdtzmn/port/commit/a99ebdb105c429b5eefce0cea46f104f89858f31"
        },
        "date": 1789246132977,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Worktree operations / enter existing (small)",
            "value": 239.959,
            "range": "10.87100000000001",
            "unit": "ms",
            "extra": "p95: 250.83 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter existing (large)",
            "value": 227.735,
            "range": "19.095999999999975",
            "unit": "ms",
            "extra": "p95: 246.831 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (small)",
            "value": 329.31,
            "range": "7.8489999999999895",
            "unit": "ms",
            "extra": "p95: 337.159 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (large)",
            "value": 331.998,
            "range": "10.525000000000034",
            "unit": "ms",
            "extra": "p95: 342.523 ms\nsamples: 20"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jdtzmn@gmail.com",
            "name": "Jacob Daitzman",
            "username": "jdtzmn"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "110ab49716d31c5f6829dd82190866d9e6d93686",
          "message": "Reduce remote SSH E2E runtime (#158)\n\n* Record remote E2E timing baseline\n\n* Parallelize remote E2E provisioning\n\n* Stream fixture images into remote daemons\n\n* Shard remote E2E scenarios with Vitest\n\n* Preserve remote E2E fixture ordering\n\n* Reuse published 404 handler in remote E2E\n\n* Cache remote E2E fixture images\n\n* Fall back when handler image is unavailable\n\n* Cache remote E2E handler image\n\n* Shard local and remote owner coverage\n\n* Keep dependent owner scenarios together\n\n* Isolate three-owner scenario setup\n\n* Decouple scenarios from fixture image cache\n\n* Use HTTP-only three-owner fixtures\n\n* Load fixture images from shared bundles\n\n* Revert \"Load fixture images from shared bundles\"\n\nThis reverts commit 9d1846849d7508891d1fb55ccff8f9b304ac4250.",
          "timestamp": "2026-09-16T15:02:20-04:00",
          "tree_id": "4323d14680553e6c701ef176f7f501b6c211d6cf",
          "url": "https://github.com/jdtzmn/port/commit/110ab49716d31c5f6829dd82190866d9e6d93686"
        },
        "date": 1789585552067,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Worktree operations / enter existing (small)",
            "value": 266.001,
            "range": "20.822000000000003",
            "unit": "ms",
            "extra": "p95: 286.823 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter existing (large)",
            "value": 265.158,
            "range": "9.58499999999998",
            "unit": "ms",
            "extra": "p95: 274.743 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (small)",
            "value": 378.466,
            "range": "17.331999999999994",
            "unit": "ms",
            "extra": "p95: 395.798 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (large)",
            "value": 395.47,
            "range": "21.970999999999947",
            "unit": "ms",
            "extra": "p95: 417.441 ms\nsamples: 20"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jdtzmn@gmail.com",
            "name": "Jacob Daitzman",
            "username": "jdtzmn"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "a4460c0de9311ea36e36a0ac00a03204097fa547",
          "message": "Improve Port discoverability (#161)\n\n* Improve npm search metadata\n\n* Explain Docker port conflict problem\n\n* Document Port alternatives\n\n* Clarify Tug comparison",
          "timestamp": "2026-09-16T20:44:02-04:00",
          "tree_id": "47debc2dd8492b6374844e0312a475ec3ab73c2e",
          "url": "https://github.com/jdtzmn/port/commit/a4460c0de9311ea36e36a0ac00a03204097fa547"
        },
        "date": 1789606034403,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Worktree operations / enter existing (small)",
            "value": 206.283,
            "range": "5.183000000000021",
            "unit": "ms",
            "extra": "p95: 211.466 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter existing (large)",
            "value": 212.787,
            "range": "7.588999999999999",
            "unit": "ms",
            "extra": "p95: 220.376 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (small)",
            "value": 292.926,
            "range": "8.045000000000016",
            "unit": "ms",
            "extra": "p95: 300.971 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (large)",
            "value": 305.592,
            "range": "8.634000000000015",
            "unit": "ms",
            "extra": "p95: 314.226 ms\nsamples: 20"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jdtzmn@gmail.com",
            "name": "Jacob Daitzman",
            "username": "jdtzmn"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "721866b640f259892fa34fe719e55382f23fc86e",
          "message": "Speed up CLI list startup (#157)\n\n* Lazy-load CLI command handlers\n\n* Preserve CLI entry point with lazy handlers\n\n* Optimize list CLI startup\n\n* Run remote split bundle on supported Bun",
          "timestamp": "2026-09-16T20:54:00-04:00",
          "tree_id": "15ab11cc2ee1f0a4fc07f932e3ddb0410e1d6a15",
          "url": "https://github.com/jdtzmn/port/commit/721866b640f259892fa34fe719e55382f23fc86e"
        },
        "date": 1789606612151,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Worktree operations / enter existing (small)",
            "value": 273.313,
            "range": "12.932000000000016",
            "unit": "ms",
            "extra": "p95: 286.245 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter existing (large)",
            "value": 271.508,
            "range": "11.636000000000024",
            "unit": "ms",
            "extra": "p95: 283.144 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (small)",
            "value": 380.564,
            "range": "28.079999999999984",
            "unit": "ms",
            "extra": "p95: 408.644 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (large)",
            "value": 405.872,
            "range": "22.740999999999985",
            "unit": "ms",
            "extra": "p95: 428.613 ms\nsamples: 20"
          }
        ]
      }
    ]
  }
}