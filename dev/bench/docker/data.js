window.BENCHMARK_DATA = {
  "lastUpdate": 1789697703134,
  "repoUrl": "https://github.com/jdtzmn/port",
  "entries": {
    "Port Docker operations": [
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
        "date": 1789246134319,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Docker operations / status (small)",
            "value": 471.406,
            "range": "21.658000000000015",
            "unit": "ms",
            "extra": "p95: 493.064 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / status (large)",
            "value": 4104.647,
            "range": "93.58100000000013",
            "unit": "ms",
            "extra": "p95: 4198.228 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / up (warm)",
            "value": 689.972,
            "range": "194.485",
            "unit": "ms",
            "extra": "p95: 884.457 ms\nsamples: 10"
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
        "date": 1789585553495,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Docker operations / status (small)",
            "value": 590.486,
            "range": "9.527000000000044",
            "unit": "ms",
            "extra": "p95: 600.013 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / status (large)",
            "value": 5228.765,
            "range": "65.47299999999996",
            "unit": "ms",
            "extra": "p95: 5294.238 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / up (warm)",
            "value": 821.829,
            "range": "23.486000000000104",
            "unit": "ms",
            "extra": "p95: 845.315 ms\nsamples: 10"
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
        "date": 1789606035860,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Docker operations / status (small)",
            "value": 436.536,
            "range": "2.98599999999999",
            "unit": "ms",
            "extra": "p95: 439.522 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / status (large)",
            "value": 3803.559,
            "range": "32.934999999999945",
            "unit": "ms",
            "extra": "p95: 3836.494 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / up (warm)",
            "value": 634.911,
            "range": "520.465",
            "unit": "ms",
            "extra": "p95: 1155.376 ms\nsamples: 10"
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
        "date": 1789606613474,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Docker operations / status (small)",
            "value": 404.748,
            "range": "10.324000000000012",
            "unit": "ms",
            "extra": "p95: 415.072 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / status (large)",
            "value": 3722.115,
            "range": "42.159000000000106",
            "unit": "ms",
            "extra": "p95: 3764.274 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / up (warm)",
            "value": 572.544,
            "range": "48.254999999999995",
            "unit": "ms",
            "extra": "p95: 620.799 ms\nsamples: 10"
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
        "date": 1789606992776,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Docker operations / status (small)",
            "value": 394.08,
            "range": "8.153999999999996",
            "unit": "ms",
            "extra": "p95: 402.234 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / status (large)",
            "value": 3551.919,
            "range": "40.777000000000044",
            "unit": "ms",
            "extra": "p95: 3592.696 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / up (warm)",
            "value": 545.535,
            "range": "54.756000000000085",
            "unit": "ms",
            "extra": "p95: 600.291 ms\nsamples: 10"
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
        "date": 1789607605664,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Docker operations / status (small)",
            "value": 540.008,
            "range": "9.04099999999994",
            "unit": "ms",
            "extra": "p95: 549.049 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / status (large)",
            "value": 4879.447,
            "range": "65.48899999999958",
            "unit": "ms",
            "extra": "p95: 4944.936 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / up (warm)",
            "value": 733.825,
            "range": "12.589999999999918",
            "unit": "ms",
            "extra": "p95: 746.415 ms\nsamples: 10"
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
        "date": 1789611386333,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Docker operations / status (small)",
            "value": 428.852,
            "range": "8.513000000000034",
            "unit": "ms",
            "extra": "p95: 437.365 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / status (large)",
            "value": 3545.516,
            "range": "21.643999999999778",
            "unit": "ms",
            "extra": "p95: 3567.16 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / up (warm)",
            "value": 578.442,
            "range": "8.134000000000015",
            "unit": "ms",
            "extra": "p95: 586.576 ms\nsamples: 10"
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
        "date": 1789614532593,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Docker operations / status (small)",
            "value": 554.055,
            "range": "5.472000000000094",
            "unit": "ms",
            "extra": "p95: 559.527 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / status (large)",
            "value": 5034.671,
            "range": "89.23899999999958",
            "unit": "ms",
            "extra": "p95: 5123.91 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / up (warm)",
            "value": 772.548,
            "range": "17.721000000000004",
            "unit": "ms",
            "extra": "p95: 790.269 ms\nsamples: 10"
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
        "date": 1789615196937,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Docker operations / status (small)",
            "value": 394.618,
            "range": "64.91500000000002",
            "unit": "ms",
            "extra": "p95: 459.533 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / status (large)",
            "value": 3302.266,
            "range": "55.71799999999985",
            "unit": "ms",
            "extra": "p95: 3357.984 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / up (warm)",
            "value": 786.167,
            "range": "655.8919999999999",
            "unit": "ms",
            "extra": "p95: 1442.059 ms\nsamples: 10"
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
        "date": 1789616621328,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Docker operations / status (small)",
            "value": 383.937,
            "range": "5.314999999999998",
            "unit": "ms",
            "extra": "p95: 389.252 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / status (large)",
            "value": 3774.118,
            "range": "60.22900000000027",
            "unit": "ms",
            "extra": "p95: 3834.347 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / up (warm)",
            "value": 619.068,
            "range": "232.94399999999996",
            "unit": "ms",
            "extra": "p95: 852.012 ms\nsamples: 10"
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
        "date": 1789618079030,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Docker operations / status (small)",
            "value": 261.111,
            "range": "8.252999999999986",
            "unit": "ms",
            "extra": "p95: 269.364 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / status (large)",
            "value": 1791.531,
            "range": "23.11500000000001",
            "unit": "ms",
            "extra": "p95: 1814.646 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / up (warm)",
            "value": 612.278,
            "range": "73.39499999999998",
            "unit": "ms",
            "extra": "p95: 685.673 ms\nsamples: 10"
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
        "date": 1789618868382,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Docker operations / status (small)",
            "value": 311.782,
            "range": "10.93100000000004",
            "unit": "ms",
            "extra": "p95: 322.713 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / status (large)",
            "value": 2337.813,
            "range": "35.98099999999977",
            "unit": "ms",
            "extra": "p95: 2373.794 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / up (warm)",
            "value": 749.836,
            "range": "6.0359999999999445",
            "unit": "ms",
            "extra": "p95: 755.872 ms\nsamples: 10"
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
          "id": "fb08f8ff1664aaba158ef1284d06924df62145cc",
          "message": "Bump version to 0.6.1 (#171)",
          "timestamp": "2026-09-17T04:25:14Z",
          "tree_id": "114272ae78f4dec4c3aa1cc9952911dbfdc61578",
          "url": "https://github.com/jdtzmn/port/commit/fb08f8ff1664aaba158ef1284d06924df62145cc"
        },
        "date": 1789619279271,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Docker operations / status (small)",
            "value": 325.981,
            "range": "12.918999999999983",
            "unit": "ms",
            "extra": "p95: 338.9 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / status (large)",
            "value": 2330.152,
            "range": "33.541999999999916",
            "unit": "ms",
            "extra": "p95: 2363.694 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / up (warm)",
            "value": 762.594,
            "range": "8.55499999999995",
            "unit": "ms",
            "extra": "p95: 771.149 ms\nsamples: 10"
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
          "id": "b84fa6f9f6c45cb1d2f61ff2d92570849f90dfc2",
          "message": "Profile lifecycle command phases (#172)",
          "timestamp": "2026-09-17T09:11:16-04:00",
          "tree_id": "e0ed5faf28732a1e3eac9423041d36d9e1b35c77",
          "url": "https://github.com/jdtzmn/port/commit/b84fa6f9f6c45cb1d2f61ff2d92570849f90dfc2"
        },
        "date": 1789650866747,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Docker operations / status (small)",
            "value": 316.532,
            "range": "14.206000000000017",
            "unit": "ms",
            "extra": "p95: 330.738 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / status (large)",
            "value": 2386.59,
            "range": "27.536000000000058",
            "unit": "ms",
            "extra": "p95: 2414.126 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / up (warm)",
            "value": 744.551,
            "range": "11.987999999999943",
            "unit": "ms",
            "extra": "p95: 756.539 ms\nsamples: 10"
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
          "id": "e83d8e06b98a59b695bff0a8739c1a3ab3587d9e",
          "message": "Honor prune --no-fetch (#175)\n\n* Honor prune no-fetch option\n\n* Wire prune no-fetch CLI option",
          "timestamp": "2026-09-17T11:24:25-04:00",
          "tree_id": "e1a704f8264fb51a99b514823f2322c1f434b0e4",
          "url": "https://github.com/jdtzmn/port/commit/e83d8e06b98a59b695bff0a8739c1a3ab3587d9e"
        },
        "date": 1789659100555,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Docker operations / status (small)",
            "value": 305.264,
            "range": "9.829000000000008",
            "unit": "ms",
            "extra": "p95: 315.093 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / status (large)",
            "value": 2354.713,
            "range": "35.996999999999844",
            "unit": "ms",
            "extra": "p95: 2390.71 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / up (warm)",
            "value": 725.563,
            "range": "15.697999999999979",
            "unit": "ms",
            "extra": "p95: 741.261 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / down",
            "value": 10595.334,
            "range": "13.768000000000029",
            "unit": "ms",
            "extra": "p95: 10609.102 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / remove (inactive services)",
            "value": 527.997,
            "range": "8.554000000000087",
            "unit": "ms",
            "extra": "p95: 536.551 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / remove (running services)",
            "value": 10761.434,
            "range": "34.074000000000524",
            "unit": "ms",
            "extra": "p95: 10795.508 ms\nsamples: 10"
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
          "id": "f237bc6c64ef025be851cc60c845e4c982db78a9",
          "message": "Skip inactive Compose teardown during remove (#176)\n\n* Skip inactive Compose teardown during remove\n\n* Preserve active services during remove",
          "timestamp": "2026-09-17T12:21:51-04:00",
          "tree_id": "e2c64a06b4ee7ab2e79a57026a79b4f5d8e8da3a",
          "url": "https://github.com/jdtzmn/port/commit/f237bc6c64ef025be851cc60c845e4c982db78a9"
        },
        "date": 1789662567677,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Docker operations / status (small)",
            "value": 320.561,
            "range": "14.388000000000034",
            "unit": "ms",
            "extra": "p95: 334.949 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / status (large)",
            "value": 2497.306,
            "range": "26.057999999999993",
            "unit": "ms",
            "extra": "p95: 2523.364 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / up (warm)",
            "value": 782.403,
            "range": "8.336000000000013",
            "unit": "ms",
            "extra": "p95: 790.739 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / down",
            "value": 10617.067,
            "range": "22.036000000000058",
            "unit": "ms",
            "extra": "p95: 10639.103 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / remove (inactive services)",
            "value": 419.012,
            "range": "7.749000000000024",
            "unit": "ms",
            "extra": "p95: 426.761 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / remove (running services)",
            "value": 10815.628,
            "range": "25.92199999999866",
            "unit": "ms",
            "extra": "p95: 10841.55 ms\nsamples: 10"
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
          "id": "68df271261062af482c8ea16fb776808c51e2039",
          "message": "Reuse enter branch preflight (#177)\n\n* Reuse enter branch preflight\n\n* Refresh stale enter preflight\n\n* Limit enter preflight retries\n\n* Format enter preflight tests",
          "timestamp": "2026-09-17T21:41:11-04:00",
          "tree_id": "9e5a682218e45da903a4a558d35460c12fb06fba",
          "url": "https://github.com/jdtzmn/port/commit/68df271261062af482c8ea16fb776808c51e2039"
        },
        "date": 1789696118249,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Docker operations / status (small)",
            "value": 336.222,
            "range": "4.657000000000039",
            "unit": "ms",
            "extra": "p95: 340.879 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / status (large)",
            "value": 2438.003,
            "range": "55.46799999999985",
            "unit": "ms",
            "extra": "p95: 2493.471 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / up (warm)",
            "value": 763.293,
            "range": "11.19399999999996",
            "unit": "ms",
            "extra": "p95: 774.487 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / down",
            "value": 10614.9,
            "range": "27.92200000000048",
            "unit": "ms",
            "extra": "p95: 10642.822 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / remove (inactive services)",
            "value": 422.806,
            "range": "14.915999999999997",
            "unit": "ms",
            "extra": "p95: 437.722 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / remove (running services)",
            "value": 10821.896,
            "range": "13.661000000000058",
            "unit": "ms",
            "extra": "p95: 10835.557 ms\nsamples: 10"
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
          "id": "7c1893baaa6fc09c7ef376001dc9c8df45869089",
          "message": "Use cached stale warning during enter (#178)",
          "timestamp": "2026-09-17T22:06:38-04:00",
          "tree_id": "2b4c0fc3740b643a46d706167f3ad9dcb47520fd",
          "url": "https://github.com/jdtzmn/port/commit/7c1893baaa6fc09c7ef376001dc9c8df45869089"
        },
        "date": 1789697703102,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Docker operations / status (small)",
            "value": 322.464,
            "range": "11.274999999999977",
            "unit": "ms",
            "extra": "p95: 333.739 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / status (large)",
            "value": 2460.482,
            "range": "94.54500000000007",
            "unit": "ms",
            "extra": "p95: 2555.027 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / up (warm)",
            "value": 760.632,
            "range": "24.40000000000009",
            "unit": "ms",
            "extra": "p95: 785.032 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / down",
            "value": 10617.809,
            "range": "18.19800000000032",
            "unit": "ms",
            "extra": "p95: 10636.007 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / remove (inactive services)",
            "value": 419.2,
            "range": "3.924000000000035",
            "unit": "ms",
            "extra": "p95: 423.124 ms\nsamples: 10"
          },
          {
            "name": "Docker operations / remove (running services)",
            "value": 10819.402,
            "range": "14.215000000000146",
            "unit": "ms",
            "extra": "p95: 10833.617 ms\nsamples: 10"
          }
        ]
      }
    ]
  }
}