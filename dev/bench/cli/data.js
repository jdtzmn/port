window.BENCHMARK_DATA = {
  "lastUpdate": 1789607603087,
  "repoUrl": "https://github.com/jdtzmn/port",
  "entries": {
    "Port CLI responsiveness": [
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
        "date": 1789246130769,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "CLI responsiveness / help",
            "value": 104.641,
            "range": "5.35199999999999",
            "unit": "ms",
            "extra": "p95: 109.993 ms\nsamples: 20"
          },
          {
            "name": "CLI responsiveness / list (small)",
            "value": 195.071,
            "range": "5.3940000000000055",
            "unit": "ms",
            "extra": "p95: 200.465 ms\nsamples: 20"
          },
          {
            "name": "CLI responsiveness / list (large)",
            "value": 208.601,
            "range": "7.51400000000001",
            "unit": "ms",
            "extra": "p95: 216.115 ms\nsamples: 20"
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
        "date": 1789585549817,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "CLI responsiveness / help",
            "value": 67.266,
            "range": "5.082999999999998",
            "unit": "ms",
            "extra": "p95: 72.349 ms\nsamples: 20"
          },
          {
            "name": "CLI responsiveness / list (small)",
            "value": 138.06,
            "range": "4.4410000000000025",
            "unit": "ms",
            "extra": "p95: 142.501 ms\nsamples: 20"
          },
          {
            "name": "CLI responsiveness / list (large)",
            "value": 148.995,
            "range": "4.121999999999986",
            "unit": "ms",
            "extra": "p95: 153.117 ms\nsamples: 20"
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
        "date": 1789606032059,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "CLI responsiveness / help",
            "value": 111.435,
            "range": "9.198999999999998",
            "unit": "ms",
            "extra": "p95: 120.634 ms\nsamples: 20"
          },
          {
            "name": "CLI responsiveness / list (small)",
            "value": 201.623,
            "range": "6.719999999999999",
            "unit": "ms",
            "extra": "p95: 208.343 ms\nsamples: 20"
          },
          {
            "name": "CLI responsiveness / list (large)",
            "value": 214.267,
            "range": "8.072000000000003",
            "unit": "ms",
            "extra": "p95: 222.339 ms\nsamples: 20"
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
        "date": 1789606609641,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "CLI responsiveness / help",
            "value": 42.514,
            "range": "7.501999999999995",
            "unit": "ms",
            "extra": "p95: 50.016 ms\nsamples: 20"
          },
          {
            "name": "CLI responsiveness / list (small)",
            "value": 32.238,
            "range": "7.727000000000004",
            "unit": "ms",
            "extra": "p95: 39.965 ms\nsamples: 20"
          },
          {
            "name": "CLI responsiveness / list (large)",
            "value": 36.009,
            "range": "6.814",
            "unit": "ms",
            "extra": "p95: 42.823 ms\nsamples: 20"
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
        "date": 1789606988954,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "CLI responsiveness / help",
            "value": 48.658,
            "range": "9.714999999999996",
            "unit": "ms",
            "extra": "p95: 58.373 ms\nsamples: 20"
          },
          {
            "name": "CLI responsiveness / list (small)",
            "value": 36.16,
            "range": "4.240000000000002",
            "unit": "ms",
            "extra": "p95: 40.4 ms\nsamples: 20"
          },
          {
            "name": "CLI responsiveness / list (large)",
            "value": 35.41,
            "range": "5.416000000000004",
            "unit": "ms",
            "extra": "p95: 40.826 ms\nsamples: 20"
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
        "date": 1789607602358,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "CLI responsiveness / help",
            "value": 40.088,
            "range": "4.708999999999996",
            "unit": "ms",
            "extra": "p95: 44.797 ms\nsamples: 20"
          },
          {
            "name": "CLI responsiveness / list (small)",
            "value": 27.277,
            "range": "8.836999999999996",
            "unit": "ms",
            "extra": "p95: 36.114 ms\nsamples: 20"
          },
          {
            "name": "CLI responsiveness / list (large)",
            "value": 28.168,
            "range": "6.43",
            "unit": "ms",
            "extra": "p95: 34.598 ms\nsamples: 20"
          }
        ]
      }
    ]
  }
}