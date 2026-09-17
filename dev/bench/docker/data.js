window.BENCHMARK_DATA = {
  "lastUpdate": 1789606613502,
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
      }
    ]
  }
}