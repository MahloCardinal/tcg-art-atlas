# Windows OCR quality check. Reads local card images; never alters them.
param([string]$Catalog = "$PSScriptRoot\..\public\data\catalog.json", [int]$Limit = 0, [string]$Only = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Wait-Result($Operation, $ResultType) {
    $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.GetAwaiter().GetResult()
}
$root = [IO.Path]::GetFullPath("$PSScriptRoot\..")
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw 'Windows OCR language unavailable.' }
$data = Get-Content -LiteralPath $Catalog -Raw -Encoding UTF8 | ConvertFrom-Json
$cards = @($data.cards | Where-Object { $_.game -eq 'onepiece' })
if ($Only) { $ids = $Only.Split(','); $cards = @($cards | Where-Object { $ids -contains $_.id }) }
if ($Limit -gt 0) { $cards = @($cards | Select-Object -First $Limit) }
$results = New-Object System.Collections.Generic.List[object]
$index = 0
foreach ($card in $cards) {
    $path = [IO.Path]::GetFullPath((Join-Path "$root\public" $card.image.TrimStart('/')))
    $file = Wait-Result ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
    $stream = Wait-Result ($file.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    try {
        $decoder = Wait-Result ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Wait-Result ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)) ([Windows.Graphics.Imaging.SoftwareBitmap])
        try { $ocr = Wait-Result ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult]) } finally { $bitmap.Dispose() }
        $flag = $ocr.Text -match '(?i)\bsample\b'
        $results.Add([PSCustomObject]@{ id = $card.id; imageSha256 = $card.imageSha256; sampleDetected = $flag; text = $ocr.Text })
        if ($flag) { Write-Output "SAMPLE: $($card.id)" }
    } finally { $stream.Dispose() }
    $index++
    if ($index % 50 -eq 0) { Write-Output "OCR $index/$($cards.Count)" }
}
$reportPath = Join-Path $root 'data\sample-check.json'
if ($Only -and (Test-Path -LiteralPath $reportPath)) {
    $existing = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $newIds = @($results | ForEach-Object { $_.id })
    foreach ($item in $existing) { if ($newIds -notcontains $item.id) { $results.Add($item) } }
}
$results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Output "Checked $($results.Count) images; flagged $(@($results | Where-Object sampleDetected).Count). Report: $reportPath"
