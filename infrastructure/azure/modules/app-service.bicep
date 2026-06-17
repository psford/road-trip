// road-trip App Service — moved into rg-stockanalyzer-prod on the shared P0v3 plan
// (asp-stockanalyzer) by the 2026-06-17 plan consolidation. road-trip's SQL Server
// and Key Vault stay in rg-roadtripmap-prod; this module is deployed to the shared RG
// via main.bicep's `scope: resourceGroup(sharedInfraResourceGroup)`.
//
// The shared plan is owned by stock-analyzer's IaC — referenced read-only here.

@description('App Service (web app) name.')
param appServiceName string

@description('Region. Defaults to the (shared) resource group location.')
param location string = resourceGroup().location

@description('Name of the existing shared App Service Plan (asp-stockanalyzer, P0v3).')
param sharedPlanName string

@description('ACR login server, e.g. acrstockanalyzerer34ug.azurecr.io')
param acrLoginServer string

@description('ACR username (admin) used by App Service to pull the container.')
param acrUsername string

@secure()
@description('ACR registry password used by App Service to pull the container.')
param acrPassword string

@description('Container image tag deployed to App Service.')
param containerImageTag string

@description('ASP.NET Core environment tag injected as an app setting.')
param environment string

@description('Key Vault backing the @Microsoft.KeyVault app-setting references (lives in rg-roadtripmap-prod).')
param keyVaultName string

@description('Shared blob storage account name (app setting Blob__AccountName).')
param blobAccountName string

@description('Client-side image processing dark-release flag, as a string ("true"/"false").')
param clientSideProcessingEnabled string

resource sharedPlan 'Microsoft.Web/serverfarms@2024-11-01' existing = {
  name: sharedPlanName
}

resource appService 'Microsoft.Web/sites@2024-11-01' = {
  name: appServiceName
  location: location
  kind: 'app,linux,container'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: sharedPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOCKER|${acrLoginServer}/roadtripmap:${containerImageTag}'
      alwaysOn: true
      ftpsState: 'FtpsOnly'
      numberOfWorkers: 1
      // Azure auto-populates these; declared so `what-if` sees no drift. They have
      // no functional meaning for a Linux container app.
      localMySqlEnabled: false
      netFrameworkVersion: 'v4.6'
    }
  }
}

// App settings in a child config resource so tag-only deploys don't respecify them.
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
    Blob__AccountName: blobAccountName
    Upload__ClientSideProcessingEnabled: clientSideProcessingEnabled
    ConnectionStrings__DefaultConnection: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=DbConnectionString)'
    ConnectionStrings__AzureStorage: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=BlobStorageConnection)'
    NPS_API_KEY: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=NpsApiKey)'
  }
}

output principalId string = appService.identity.principalId
output defaultHostName string = appService.properties.defaultHostName
