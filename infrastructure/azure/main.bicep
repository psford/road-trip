// Road-trip production infrastructure.
//
// This file is the source of truth for the Azure resources in rg-roadtripmap-prod
// plus the cross-RG role assignments road-trip depends on. It is authored so that
// `az deployment group what-if` against the current production state shows zero
// changes, and so that `az deployment group create` against an empty resource
// group rebuilds the environment exactly as it currently exists.
//
// Cross-RG dependencies (NOT managed here, only referenced):
//   - Storage account `stockanalyzerblob`      (rg-stockanalyzer-prod)
//   - Container registry `acrstockanalyzerer34ug` (rg-stockanalyzer-prod)
//
// Secrets policy:
//   - Key Vault secret VALUES are managed out-of-band (portal / az keyvault).
//     Bicep references the secrets with `existing` so it never overwrites them.
//   - SQL admin password and ACR password are `@secure()` params supplied per-deploy.
//
// Container image:
//   - `containerImageTag` parameter; default matches the current prod tag.
//     The GitHub Actions deploy workflow updates the tag via `az webapp config
//     container set`; Bicep reflects the current tag so what-if stays clean.

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
param containerImageTag string = 'prod-33'

@description('Ephemeral dev firewall rule for SQL (WSL tunnel). IP only, no pw.')
param wsl2TempFirewallIp string = '38.42.115.201'

// Known service principal object IDs (for RBAC). Declared explicitly so the
// role assignment resources carry them as parameters rather than magic strings.
@description('Object ID of github-deploy-rt SP (road-trip CI deploys).')
param githubDeployRtObjectId string = '5693632f-69d8-4482-9820-355c3bea04c3'

@description('Object ID of legacy github-deploy SP (subscription Contributor).')
param githubDeployObjectId string = '9c7eb26a-75f0-4359-ad5b-9146558530fb'

// Cross-RG references — where shared infrastructure actually lives.
@description('Resource group hosting the shared storage account and ACR.')
param sharedInfraResourceGroup string = 'rg-stockanalyzer-prod'

@description('Cross-RG blob storage account (shared with stock-analyzer).')
param sharedStorageAccountName string = 'stockanalyzerblob'

// --------------------------------------------------------------------------
// Naming
// --------------------------------------------------------------------------

var sqlServerName = 'sql-roadtripmap-prod'
var sqlDatabaseName = 'roadtripmap-db'
var appServicePlanName = 'asp-roadtripmap-prod'
var appServiceName = 'app-roadtripmap-prod'
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

resource keyVault 'Microsoft.KeyVault/vaults@2024-04-01-preview' = {
  name: keyVaultName
  location: location
  properties: {
    enableRbacAuthorization: true
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
  }
}

// Secrets in `kv-roadtripmap-prod` are managed out-of-band — their values never
// flow through Bicep. The App Service resolves them via `@Microsoft.KeyVault(...)`
// app settings below. Expected secrets (name: purpose):
//   DbConnectionString     — Azure SQL connection string
//   BlobStorageConnection  — `stockanalyzerblob` connection string
//   NpsApiKey              — National Park Service API key

// --------------------------------------------------------------------------
// App Service Plan + App Service
// --------------------------------------------------------------------------

resource appServicePlan 'Microsoft.Web/serverfarms@2024-11-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  sku: {
    name: 'B1'
    tier: 'Basic'
    size: 'B1'
    family: 'B'
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource appService 'Microsoft.Web/sites@2024-11-01' = {
  name: appServiceName
  location: location
  kind: 'app,linux,container'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOCKER|${acrLoginServer}/roadtripmap:${containerImageTag}'
      alwaysOn: true
      ftpsState: 'FtpsOnly'
      numberOfWorkers: 1
      // Azure auto-populates these three fields; declared here so `what-if` sees
      // no drift. They have no functional meaning for a Linux container app.
      localMySqlEnabled: false
      netFrameworkVersion: 'v4.6'
    }
  }
}

// App settings are carried in a child `config` resource so tag-only deploys
// don't have to respecify everything, and the deploy workflow can manage the
// image tag separately.
resource appServiceSettings 'Microsoft.Web/sites/config@2024-11-01' = {
  parent: appService
  name: 'appsettings'
  properties: {
    WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'false'
    ASPNETCORE_ENVIRONMENT: environment
    WEBSITES_PORT: '5100'
    DOCKER_REGISTRY_SERVER_URL: 'https://${acrLoginServer}'
    DOCKER_REGISTRY_SERVER_USERNAME: acrUsername
    DOCKER_REGISTRY_SERVER_PASSWORD: acrPassword
    ConnectionStrings__DefaultConnection: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=DbConnectionString)'
    ConnectionStrings__AzureStorage: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=BlobStorageConnection)'
    NPS_API_KEY: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=NpsApiKey)'
  }
}

// --------------------------------------------------------------------------
// Role assignments
// --------------------------------------------------------------------------
// Role definition IDs (subscription-level):
//   Key Vault Secrets User        4633458b-17de-408a-b874-0445c86b69e6
//   Storage Blob Data Contributor ba92f5b4-2d11-453d-a403-e96b0029c9fe
//
// Role-assignment GUIDs are pinned to the existing names so Bicep updates the
// actual resources rather than creating duplicates alongside them. When the
// environment is rebuilt from scratch, these GUIDs are arbitrary and will be
// recreated under these same names.

// App Service MSI → KV Secrets User.
resource roleKvAppService 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: 'f5d9fe32-df13-5e72-9a9a-8a699587e839'
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: appService.identity.principalId
    principalType: 'ServicePrincipal'
  }
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
}

// Cross-RG reference to shared storage account for adding CORS to blob services.
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  scope: resourceGroup(sharedInfraResourceGroup)
  name: sharedStorageAccountName
}

// Blob services configuration with CORS rules for browser direct-upload.
resource blobServices 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        {
          allowedOrigins: [
            'https://roadtripmap.azurewebsites.net'
            'https://localhost:5001'
          ]
          allowedMethods: [ 'GET', 'PUT', 'HEAD', 'OPTIONS' ]
          allowedHeaders: [ '*' ]
          exposedHeaders: [ 'x-ms-*' ]
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

// App Service MSI → Storage Blob Data Contributor (cross-RG, for per-trip blobs).
module roleStorageBlobAppService 'modules/storage-rbac.bicep' = {
  name: 'role-storage-blob-app-service'
  scope: resourceGroup(sharedInfraResourceGroup)
  params: {
    storageAccountName: sharedStorageAccountName
    principalId: appService.identity.principalId
    roleDefinitionId: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
    roleAssignmentName: '8066a9a7-16a6-4d2d-a76a-46db1378beca'
  }
}

// --------------------------------------------------------------------------
// Outputs
// --------------------------------------------------------------------------

output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output sqlDatabaseName string = sqlDatabase.name
output webAppUrl string = 'https://${appService.properties.defaultHostName}'
output appServicePrincipalId string = appService.identity.principalId
