window.BENCHMARK_DATA = {
  "lastUpdate": 1789246131660,
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
      }
    ]
  }
}