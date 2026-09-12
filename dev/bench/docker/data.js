window.BENCHMARK_DATA = {
  "lastUpdate": 1789246134349,
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
      }
    ]
  }
}