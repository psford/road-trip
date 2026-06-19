import Foundation

/// Resolves the API base URL per build configuration, so the same code targets the local
/// dev backend, the Azure dev slot (TestFlight), or prod without edits.
///
/// Resolution order:
/// 1. `API_BASE_URL` environment variable — ad-hoc override for the simulator and tests
///    (e.g. point the sim app at a deployed slot without rebuilding). Not available to
///    on-device TestFlight builds, which fall through to the compile-time default.
/// 2. Compile-time default selected by build config:
///    - **Debug** → local backend (`http://localhost:5100`)
///    - **Release-TestFlight** (`DEVSLOT` flag) → Azure dev slot
///    - **Release** → prod
///
/// Dev-slot URL follows Azure's slot format (`<app>-<slot>.azurewebsites.net`); the slot
/// itself is provisioned in design AC7 (not yet live).
enum APIEnvironment {
    /// The base URL the app should use right now.
    static var baseURL: URL {
        resolve(override: ProcessInfo.processInfo.environment["API_BASE_URL"])
    }

    /// Pure resolution (testable): override string if it's a valid URL, else the default.
    static func resolve(override: String?) -> URL {
        if let override, let url = URL(string: override), url.scheme != nil {
            return url
        }
        return defaultBaseURL
    }

    /// Compile-time default for the active build configuration.
    static var defaultBaseURL: URL {
        #if DEBUG
        return URL(string: "http://localhost:5100")!
        #elseif DEVSLOT
        return URL(string: "https://app-roadtripmap-prod-dev.azurewebsites.net")!
        #else
        return URL(string: "https://app-roadtripmap-prod.azurewebsites.net")!
        #endif
    }
}
