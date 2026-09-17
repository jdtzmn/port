window.BENCHMARK_DATA = {
  "lastUpdate": 1789606032986,
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
      }
    ]
  }
}