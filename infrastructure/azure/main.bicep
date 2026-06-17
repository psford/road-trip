// Road-trip production infrastructure.
//
// This file is the source of truth for road-trip's Azure resources. It is authored
// so that `az deployment group what-if` against the current production state shows
// zero changes, and so that `az deployment group create` rebuilds the environment
// exactly as it currently exists.
//
// Resource-group topology (since the 2026-06-17 P0v3 plan consolidation):
//   - SQL Server + DB, Key Vault, and the KV role assignments live in
//     `rg-roadtripmap-prod` (this template's target scope).
//   - The App Service (`app-roadtripmap-prod`) was moved onto the shared P0v3 plan
//     `asp-stockanalyzer` in `rg-stockanalyzer-prod`. It is created by the
//     `appService` module below, scoped to that resource group. The former
//     dedicated `asp-roadtripmap-prod` (B1) plan has been deleted.
//
// Cross-RG dependencies (NOT managed here, only referenced):
//   - App Service Plan `asp-stockanalyzer`     (rg-stockanalyzer-prod, owned by stock-analyzer)
//   - Storage account   `stockanalyzerblob`    (rg-stockanalyzer-prod)
//   - Container registry `acrstockanalyzerer34ug` (rg-stockanalyzer-prod)
//
// Secrets policy:
//   - Key Vault secret VALUES are managed out-of-band (portal / az keyvault).
//   - SQL admin password and ACR password are `@secure()` params supplied per-deploy.

targetScope = 'resourceGroup'

// --------------------------------------------------------------------------
// Parameters
// --------------------------------------------------------------------------

@description('Azure region. Defaults to the resource group location.')
param location string = resourceGroup().location

@description('ASP.NET Core environment tag injected as an app setting.')
param environment string = 'Production'

@description('SQL Server administrator login.')
param sqlAdminUsername string = 'sqladmin'

@secure()
@description('SQL Server administrator password. Rotate in KV + pass on deploy.')
param sqlAdminPassword string

@secure()
@description('ACR registry password used by App Service to pull the container.')
param acrPassword string

@description('Container image tag deployed to App Service. Bump each deploy.')
param containerImageTag string = 'prod-70'

@description('Ephemeral dev firewall rule for SQL (WSL tunnel). IP only, no pw.')
param wsl2TempFirewallIp string = '38.42.115.201'

@description('Object ID of github-deploy-rt SP (road-trip CI deploys).')
param githubDeployRtObjectId string = '5693632f-69d8-4482-9820-355c3bea04c3'

@description('Object ID of legacy github-deploy SP (subscription Contributor).')
param githubDeployObjectId string = '9c7eb26a-75f0-4359-ad5b-9146558530fb'

// Cross-RG references — where shared infrastructure actually lives.
@description('Resource group hosting the shared plan, storage account, and ACR.')
param sharedInfraResourceGroup string = 'rg-stockanalyzer-prod'

@description('Cross-RG blob storage account (shared with stock-analyzer).')
param sharedStorageAccountName string = 'stockanalyzerblob'

// --------------------------------------------------------------------------
// Naming
// --------------------------------------------------------------------------

var sqlServerName = 'sql-roadtripmap-prod'
var sqlDatabaseName = 'roadtripmap-db'
var appServiceName = 'app-roadtripmap-prod'
var sharedAppServicePlanName = 'asp-stockanalyzer'
var keyVaultName = 'kv-roadtripmap-prod'
var acrLoginServer = 'acrstockanalyzerer34ug.azurecr.io'
var acrUsername = 'acrstockanalyzerer34ug'

// --------------------------------------------------------------------------
// SQL Server + Database + firewall
// --------------------------------------------------------------------------

resource sqlServer 'Microsoft.Sql/servers@2024-11-01-preview' = {
  name: sqlServerName
  location: location
  properties: {
    administratorLogin: sqlAdminUsername
    administratorLoginPassword: sqlAdminPassword
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    version: '12.0'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2024-11-01-preview' = {
  parent: sqlServer
  name: sqlDatabaseName
  location: location
  sku: {
    name: 'Basic'
    tier: 'Basic'
    capacity: 5
  }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    maxSizeBytes: 2147483648
  }
}

resource sqlFirewallAllowAzure 'Microsoft.Sql/servers/firewallRules@2024-11-01-preview' = {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource sqlFirewallWslTemp 'Microsoft.Sql/servers/firewallRules@2024-11-01-preview' = {
  parent: sqlServer
  name: 'wsl2-temp'
  properties: {
    startIpAddress: wsl2TempFirewallIp
    endIpAddress: wsl2TempFirewallIp
  }
}

// --------------------------------------------------------------------------
// Key Vault
// --------------------------------------------------------------------------

// Key Vault — provisioned via the claude-env shared module. Standard SKU + RBAC
// auth are baked into the module; soft-delete retention uses the module default.
module kv 'br:acrstockanalyzerer34ug.azurecr.io/bicep/modules/key-vault:1.0.0' = {
  name: 'kv'
  params: {
    keyVaultName: keyVaultName
    location: location
  }
}

// Existing-reference to the module-created vault so role assignments keep their
// scope wiring and fixed literal names. Each dependsOn the module so the vault
// provisions first (an `existing` ref carries no implicit dependency).
resource keyVault 'Microsoft.KeyVault/vaults@2024-04-01-preview' existing = {
  name: keyVaultName
}

// Secrets in `kv-roadtripmap-prod` are managed out-of-band — values never flow
// through Bicep. The App Service resolves them via `@Microsoft.KeyVault(...)` app
// settings (in the app-service module). Expected secrets (name: purpose):
//   DbConnectionString     — Azure SQL connection string
//   BlobStorageConnection  — `stockanalyzerblob` connection string
//   NpsApiKey              — National Park Service API key

// --------------------------------------------------------------------------
// App Service (cross-RG: runs in rg-stockanalyzer-prod on the shared P0v3 plan)
// --------------------------------------------------------------------------

module appService 'modules/app-service.bicep' = {
  name: 'app-service'
  scope: resourceGroup(sharedInfraResourceGroup)
  params: {
    appServiceName: appServiceName
    location: location
    sharedPlanName: sharedAppServicePlanName
    acrLoginServer: acrLoginServer
    acrUsername: acrUsername
    acrPassword: acrPassword
    containerImageTag: containerImageTag
    environment: environment
    keyVaultName: keyVaultName
    blobAccountName: sharedStorageAccountName
    clientSideProcessingEnabled: 'true'
  }
}

// --------------------------------------------------------------------------
// Role assignments
// --------------------------------------------------------------------------
// Role definition IDs (subscription-level):
//   Key Vault Secrets User        4633458b-17de-408a-b874-0445c86b69e6
//   Storage Blob Data Contributor ba92f5b4-2d11-453d-a403-e96b0029c9fe
//
// Role-assignment GUIDs are pinned to the live names so Bicep updates the actual
// resources rather than creating duplicates alongside them.

// App Service MSI → KV Secrets User. (App identity now comes from the module.)
resource roleKvAppService 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: '61ad2060-f2e7-44a9-952a-33b685c3065d'
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: appService.outputs.principalId
    principalType: 'ServicePrincipal'
  }
  dependsOn: [ kv ]
}

// github-deploy-rt SP → KV Secrets User. Needed for CI preflight validation.
resource roleKvGithubDeployRt 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: '9d0f0615-8a41-4beb-8cc5-1ab79dd63be6'
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: githubDeployRtObjectId
    principalType: 'ServicePrincipal'
  }
  dependsOn: [ kv ]
}

// Legacy github-deploy SP → KV Secrets User. Retained until fully migrated to rt.
resource roleKvGithubDeploy 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: '9f9ae258-6e99-4dbf-9a50-99de75a10b8d'
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: githubDeployObjectId
    principalType: 'ServicePrincipal'
  }
  dependsOn: [ kv ]
}

// NOTE: Blob CORS is intentionally NOT managed here. `stockanalyzerblob` is a
// SHARED account (road-trip, stock-analyzer, photoportfolio), and setting CORS via
// `Microsoft.Storage/.../blobServices/default` replaces the WHOLE account's
// blob-service config — so any one project's deploy would clobber the others'
// origins (and other blobServices properties). road-trip's required origins
// (`app-roadtripmap-prod.azurewebsites.net`, `https://psfordtheriver.com`) are
// present in the live shared CORS and managed out-of-band. Centralizing
// shared-account CORS ownership in one place is a tracked follow-up; until then no
// single project's IaC should own it. (Previously a `blob-cors` module here did,
// which the 2026-06-17 what-if caught clobbering the shared rules.)

// App Service MSI → Storage Blob Data Contributor (cross-RG, for per-trip blobs).
module roleStorageBlobAppService 'modules/storage-rbac.bicep' = {
  name: 'role-storage-blob-app-service'
  scope: resourceGroup(sharedInfraResourceGroup)
  params: {
    storageAccountName: sharedStorageAccountName
    principalId: appService.outputs.principalId
    roleDefinitionId: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
    roleAssignmentName: '46c19f15-0fa8-4bb3-8171-e56f670d0cf4'
  }
}

// --------------------------------------------------------------------------
// Outputs
// --------------------------------------------------------------------------

output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output sqlDatabaseName string = sqlDatabase.name
output webAppUrl string = 'https://${appService.outputs.defaultHostName}'
output appServicePrincipalId string = appService.outputs.principalId
