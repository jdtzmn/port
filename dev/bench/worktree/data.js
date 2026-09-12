window.BENCHMARK_DATA = {
  "lastUpdate": 1789246133010,
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
      }
    ]
  }
}