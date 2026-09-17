window.BENCHMARK_DATA = {
  "lastUpdate": 1789618866808,
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
          "id": "49a401da997368158606a54975adcd20c64b35fc",
          "message": "Fix Bun-only runtime requirement (#163)\n\n* Run published CLI with Node\n\n* Smoke test Port under Node in CI\n\n* Document Node runtime requirement\n\n* Verify packaged CLI runs without Bun\n\n* Format Node package smoke test\n\n* Restore Bun installation guidance\n\n* Remove Node runtime installation note",
          "timestamp": "2026-09-16T21:00:17-04:00",
          "tree_id": "1895259e12473b7fcf5c01f71c23091387013592",
          "url": "https://github.com/jdtzmn/port/commit/49a401da997368158606a54975adcd20c64b35fc"
        },
        "date": 1789606991401,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Worktree operations / enter existing (small)",
            "value": 267.268,
            "range": "501.526",
            "unit": "ms",
            "extra": "p95: 768.794 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter existing (large)",
            "value": 269.173,
            "range": "100.66399999999999",
            "unit": "ms",
            "extra": "p95: 369.837 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (small)",
            "value": 354.086,
            "range": "9.361999999999966",
            "unit": "ms",
            "extra": "p95: 363.448 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (large)",
            "value": 369.23,
            "range": "11.98599999999999",
            "unit": "ms",
            "extra": "p95: 381.216 ms\nsamples: 20"
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
          "id": "8d14f4fbc8e2945f77523f225b2b1ae1539c2813",
          "message": "Bump version to 0.6.0 (#164)",
          "timestamp": "2026-09-16T21:10:00-04:00",
          "tree_id": "eb8f2800e1831cbcc96373ef6839a225b205486c",
          "url": "https://github.com/jdtzmn/port/commit/8d14f4fbc8e2945f77523f225b2b1ae1539c2813"
        },
        "date": 1789607604382,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Worktree operations / enter existing (small)",
            "value": 336.927,
            "range": "12.503999999999962",
            "unit": "ms",
            "extra": "p95: 349.431 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter existing (large)",
            "value": 335.773,
            "range": "8.088999999999999",
            "unit": "ms",
            "extra": "p95: 343.862 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (small)",
            "value": 443.806,
            "range": "5.694999999999993",
            "unit": "ms",
            "extra": "p95: 449.501 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (large)",
            "value": 459.103,
            "range": "6.5020000000000095",
            "unit": "ms",
            "extra": "p95: 465.605 ms\nsamples: 20"
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
          "id": "811623eead5ba51a18c8fa535bf8649e02c72e5e",
          "message": "Profile command execution phases (#166)\n\n* Add opt-in command profiling\n\n* Profile command execution phases\n\n* Harden command profile output\n\n* Test profiling on direct command exits",
          "timestamp": "2026-09-16T22:13:33-04:00",
          "tree_id": "abf477a9cece2ea16921902cfb36fef66b2c5419",
          "url": "https://github.com/jdtzmn/port/commit/811623eead5ba51a18c8fa535bf8649e02c72e5e"
        },
        "date": 1789611385072,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Worktree operations / enter existing (small)",
            "value": 344.608,
            "range": "8.629999999999995",
            "unit": "ms",
            "extra": "p95: 353.238 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter existing (large)",
            "value": 343.095,
            "range": "7.076999999999998",
            "unit": "ms",
            "extra": "p95: 350.172 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (small)",
            "value": 452.194,
            "range": "8.300000000000011",
            "unit": "ms",
            "extra": "p95: 460.494 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (large)",
            "value": 466.249,
            "range": "15.964999999999975",
            "unit": "ms",
            "extra": "p95: 482.214 ms\nsamples: 20"
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
          "id": "7645b3e7bc4838b2721045c15d79ca588c52dd6e",
          "message": "Make query commands side-effect free (#167)\n\n* Classify query commands before dispatch\n\n* Keep status and urls side-effect free\n\n* Fix query command integration expectations",
          "timestamp": "2026-09-16T23:04:45-04:00",
          "tree_id": "64b449cf0ec940e1600599dece70d5093166d026",
          "url": "https://github.com/jdtzmn/port/commit/7645b3e7bc4838b2721045c15d79ca588c52dd6e"
        },
        "date": 1789614531289,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Worktree operations / enter existing (small)",
            "value": 321.081,
            "range": "10.664999999999964",
            "unit": "ms",
            "extra": "p95: 331.746 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter existing (large)",
            "value": 323.946,
            "range": "3.3969999999999914",
            "unit": "ms",
            "extra": "p95: 327.343 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (small)",
            "value": 427.732,
            "range": "4.847999999999956",
            "unit": "ms",
            "extra": "p95: 432.58 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (large)",
            "value": 441.38,
            "range": "7.257000000000005",
            "unit": "ms",
            "extra": "p95: 448.637 ms\nsamples: 20"
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
          "id": "e74ba26ad39d9f9fe16c48c21f5b3aa72ca01a9d",
          "message": "Move remote SSH observation into the coordinator (#165)\n\n* Add coordinator observation task manager\n\n* Run remote observation in coordinator\n\n* Hand off SSH observation lifecycle\n\n* Harden coordinator observation handoff\n\n* Keep explicit SSH observation ephemeral",
          "timestamp": "2026-09-16T23:16:36-04:00",
          "tree_id": "fc59be7a1ef57ceafc0424e9c3fcc451a3eb4a00",
          "url": "https://github.com/jdtzmn/port/commit/e74ba26ad39d9f9fe16c48c21f5b3aa72ca01a9d"
        },
        "date": 1789615195451,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Worktree operations / enter existing (small)",
            "value": 341.711,
            "range": "18.865999999999985",
            "unit": "ms",
            "extra": "p95: 360.577 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter existing (large)",
            "value": 341.195,
            "range": "6.521999999999991",
            "unit": "ms",
            "extra": "p95: 347.717 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (small)",
            "value": 450.097,
            "range": "4.983000000000004",
            "unit": "ms",
            "extra": "p95: 455.08 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (large)",
            "value": 467.196,
            "range": "44.798",
            "unit": "ms",
            "extra": "p95: 511.994 ms\nsamples: 20"
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
          "id": "2829b5fc53565f8dbbafe2c07ce05f4ef11158a7",
          "message": "Cache stale worktree snapshots (#168)\n\n* Cache stale worktree snapshots\n\n* Invalidate stale worktree cache on mutations\n\n* Format stale worktree cache files",
          "timestamp": "2026-09-16T23:40:44-04:00",
          "tree_id": "ac60389a081473b22e99ff4c2de23a798048596b",
          "url": "https://github.com/jdtzmn/port/commit/2829b5fc53565f8dbbafe2c07ce05f4ef11158a7"
        },
        "date": 1789616620135,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Worktree operations / enter existing (small)",
            "value": 333.049,
            "range": "10.730999999999995",
            "unit": "ms",
            "extra": "p95: 343.78 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter existing (large)",
            "value": 337.927,
            "range": "11.859999999999957",
            "unit": "ms",
            "extra": "p95: 349.787 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (small)",
            "value": 446.796,
            "range": "9.192000000000007",
            "unit": "ms",
            "extra": "p95: 455.988 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (large)",
            "value": 459.237,
            "range": "6.948999999999955",
            "unit": "ms",
            "extra": "p95: 466.186 ms\nsamples: 20"
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
          "id": "241fc5493c11c322a4404440e208ddd455399dcc",
          "message": "Use Docker inventory for status (#169)\n\n* Add Docker Compose service inventory\n\n* Use Docker inventory for worktree status\n\n* Avoid Compose fallback for absent projects\n\n* Harden Docker status inventory",
          "timestamp": "2026-09-17T00:05:09-04:00",
          "tree_id": "2318033580383f82c5c39d978eef09e8267e9b41",
          "url": "https://github.com/jdtzmn/port/commit/241fc5493c11c322a4404440e208ddd455399dcc"
        },
        "date": 1789618077535,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Worktree operations / enter existing (small)",
            "value": 326.887,
            "range": "6.065999999999974",
            "unit": "ms",
            "extra": "p95: 332.953 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter existing (large)",
            "value": 327.752,
            "range": "5.807999999999993",
            "unit": "ms",
            "extra": "p95: 333.56 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (small)",
            "value": 431.599,
            "range": "8.355000000000018",
            "unit": "ms",
            "extra": "p95: 439.954 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (large)",
            "value": 447.89,
            "range": "6.896999999999991",
            "unit": "ms",
            "extra": "p95: 454.787 ms\nsamples: 20"
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
          "id": "111c82adddff7a5ec07c6a995b7de9d63751dddb",
          "message": "Use Docker inventory for URLs (#170)",
          "timestamp": "2026-09-17T00:18:20-04:00",
          "tree_id": "4c928ae61603fb131bc4c3a4418fc169551067d3",
          "url": "https://github.com/jdtzmn/port/commit/111c82adddff7a5ec07c6a995b7de9d63751dddb"
        },
        "date": 1789618866782,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Worktree operations / enter existing (small)",
            "value": 221.723,
            "range": "8.613999999999976",
            "unit": "ms",
            "extra": "p95: 230.337 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter existing (large)",
            "value": 221.084,
            "range": "10.12299999999999",
            "unit": "ms",
            "extra": "p95: 231.207 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (small)",
            "value": 300.635,
            "range": "19.77199999999999",
            "unit": "ms",
            "extra": "p95: 320.407 ms\nsamples: 20"
          },
          {
            "name": "Worktree operations / enter new (large)",
            "value": 303.957,
            "range": "16.374000000000024",
            "unit": "ms",
            "extra": "p95: 320.331 ms\nsamples: 20"
          }
        ]
      }
    ]
  }
}