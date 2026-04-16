using Azure.Storage.Blobs;
using FluentAssertions;
using Xunit;

namespace RoadTripMap.Tests.Infrastructure;

/// <summary>
/// Exception thrown when a test should be skipped due to missing prerequisites (e.g., Docker).
/// xUnit treats this as a skip rather than a failure.
/// </summary>
public class SkipTestException : Exception
{
    public SkipTestException(string message) : base(message) { }
}

/// <summary>
/// xUnit IAsyncLifetime fixture that starts and stops an Azurite instance via docker-compose.
/// Azurite is a storage emulator for local development and testing.
/// Connection string: UseDevelopmentStorage=true (maps to http://127.0.0.1:10000)
/// </summary>
[CollectionDefinition(nameof(AzuriteCollection))]
public class AzuriteCollection : ICollectionFixture<AzuriteFixture>
{
    // This has no code, and never creates an instance of AzuriteFixture.
    // It's just used to define the collection for xUnit.
}

public class AzuriteFixture : IAsyncLifetime
{
    private const string DockerComposeFile = "docker-compose.azurite.yml";
    private const string ContainerName = "azurite-test";
    private const int MaxRetries = 30;
    private const int RetryDelayMs = 1000;

    // Azurite connection string for local testing
    public string ConnectionString { get; } = "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;";

    private bool _startedViaDocker;

    public async Task InitializeAsync()
    {
        // If Azurite is already running (e.g. native install, dev container), just use it.
        if (await IsAzuriteReachableAsync())
        {
            _startedViaDocker = false;
            return;
        }

        // Otherwise require Docker + docker-compose to start it.
        if (!IsDockerAvailable())
        {
            throw new SkipTestException("Azurite is not running and Docker is not available; skipping Azurite integration tests");
        }

        var dockerComposeFilePath = FindDockerComposeFile();
        if (!File.Exists(dockerComposeFilePath))
        {
            throw new FileNotFoundException($"docker-compose.azurite.yml not found at {dockerComposeFilePath}");
        }

        var result = await ExecuteDockerComposeAsync(
            ["up", "-d"],
            Path.GetDirectoryName(dockerComposeFilePath) ?? ".");

        if (result != 0)
        {
            throw new InvalidOperationException("Failed to start Azurite via docker-compose");
        }

        _startedViaDocker = true;
        await WaitForAzuriteAsync();
    }

    public async Task DisposeAsync()
    {
        // Only tear down if we started Azurite ourselves
        if (!_startedViaDocker) return;

        var dockerComposeFilePath = FindDockerComposeFile();
        await ExecuteDockerComposeAsync(
            ["down", "-v"],
            Path.GetDirectoryName(dockerComposeFilePath) ?? ".");
    }

    /// <summary>Check if Azurite is already listening on the expected endpoint.</summary>
    private async Task<bool> IsAzuriteReachableAsync()
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            // Azurite returns 400/403 without auth but only if it's actually listening.
            var response = await http.GetAsync("http://127.0.0.1:10000/");
            return true; // Any HTTP response means the service is up
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Check if the docker command is available.
    /// </summary>
    private static bool IsDockerAvailable()
    {
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "docker",
                Arguments = "--version",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            var process = System.Diagnostics.Process.Start(psi);
            if (process == null) return false;

            process.WaitForExit(5000); // 5 second timeout
            return process.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Find the docker-compose.azurite.yml file by searching upward from test assembly location.
    /// </summary>
    private static string FindDockerComposeFile()
    {
        var testAssemblyDir = Path.GetDirectoryName(typeof(AzuriteFixture).Assembly.Location);
        var currentDir = new DirectoryInfo(testAssemblyDir ?? ".");

        // Search up the directory tree for docker-compose.azurite.yml
        while (currentDir != null)
        {
            var filePath = Path.Combine(currentDir.FullName, DockerComposeFile);
            if (File.Exists(filePath))
            {
                return filePath;
            }

            // Also check in the bin subdirectory
            filePath = Path.Combine(currentDir.FullName, "bin", DockerComposeFile);
            if (File.Exists(filePath))
            {
                return filePath;
            }

            currentDir = currentDir.Parent;
        }

        // Default location if not found
        return Path.Combine(testAssemblyDir ?? ".", DockerComposeFile);
    }

    /// <summary>
    /// Wait for Azurite to be ready by attempting a BlobServiceClient connection.
    /// </summary>
    private async Task WaitForAzuriteAsync()
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        Exception? lastException = null;

        while (sw.Elapsed < TimeSpan.FromSeconds(MaxRetries * RetryDelayMs / 1000))
        {
            try
            {
                var client = new BlobServiceClient(ConnectionString);
                await client.GetPropertiesAsync();
                return; // Success
            }
            catch (Exception ex)
            {
                lastException = ex;
                await Task.Delay(RetryDelayMs);
            }
        }

        throw new TimeoutException(
            $"Azurite failed to start after {MaxRetries * RetryDelayMs / 1000} seconds",
            lastException);
    }

    /// <summary>
    /// Execute a docker-compose command in a given directory.
    /// </summary>
    private static async Task<int> ExecuteDockerComposeAsync(string[] args, string workingDirectory)
    {
        var psi = new System.Diagnostics.ProcessStartInfo
        {
            FileName = "docker",
            Arguments = $"compose -f \"{DockerComposeFile}\" " + string.Join(" ", args.Select(a => $"\"{a}\"")),
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        var process = System.Diagnostics.Process.Start(psi);
        if (process == null)
        {
            throw new InvalidOperationException("Failed to start docker-compose process");
        }

        await process.WaitForExitAsync();
        return process.ExitCode;
    }
}
