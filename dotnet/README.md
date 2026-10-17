# dotnet test harness

Compiles the engine-free Unity sources by **linking** them (nothing is copied):

* `Blox.Pure/` - netstandard2.1, C# 9, warnings as errors: `Runtime/Data/**`, `Runtime/Meshing/Core/**`,
  `Runtime/Live/**` except `Live/Unity/**`. This mirrors Unity's compiler profile.
* `Blox.Tests/` - xUnit tests (net8.0).

Run (Windows or Linux, .NET 8 SDK):

```
dotnet test dotnet/Blox.sln
```

Optional data-driven tests are reported as *skipped* when their inputs are absent:
`pipeline/tests/fixtures/golden/` (pipeline golden chunk) and `build/testscene/` (pipeline look-test world).
