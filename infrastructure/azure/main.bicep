param location string = resourceGroup().location
param environment string = 'Production'

@secure()
param sqlAdminPassword string

param sqlAdminUsername string = 'sqladmin'
param storageConnectionString string

@secure()
param npsApiKey string

var sqlServerName = 'sql-roadtripmap-prod'
var sqlDatabaseName = 'roadtripmap-db'
var appServicePlanName = 'asp-roadtripmap-prod'
var appServiceName = 'app-roadtripmap-prod'
var keyVaultName = 'kv-roadtripmap-prod'

// SQL Server
resource sqlServer 'Microsoft.Sql/servers@2024-11-01-preview' = {
  name: sqlServerName
  location: location
  properties: {
    administratorLogin: sqlAdminUsername
    administratorLoginPassword: sqlAdminPassword
    minimalTlsVersion: '1.2'
    version: '12.0'
  }
}

// SQL Database
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

// Firewall rule to allow Azure services
resource firewallRule 'Microsoft.Sql/servers/firewallRules@2024-11-01-preview' = {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// App Service Plan
resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
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

// Key Vault
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

// Construct connection string from SQL server outputs
var sqlConnectionString = 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Initial Catalog=${sqlDatabaseName};Persist Security Info=False;User ID=${sqlAdminUsername};Password=${sqlAdminPassword};MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;'

// Key Vault Secrets
resource dbConnectionStringSecret 'Microsoft.KeyVault/vaults/secrets@2024-04-01-preview' = {
  parent: keyVault
  name: 'DbConnectionString'
  properties: {
    value: sqlConnectionString
  }
}

resource blobStorageConnectionSecret 'Microsoft.KeyVault/vaults/secrets@2024-04-01-preview' = {
  parent: keyVault
  name: 'BlobStorageConnection'
  properties: {
    value: storageConnectionString
  }
}

resource npsApiKeySecret 'Microsoft.KeyVault/vaults/secrets@2024-04-01-preview' = {
  parent: keyVault
  name: 'NpsApiKey'
  properties: {
    value: npsApiKey
  }
}

// App Service
resource appService 'Microsoft.Web/sites@2023-12-01' = {
  name: appServiceName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOCKER|acrstockanalyzerer34ug.azurecr.io/roadtripmap:latest'
      alwaysOn: true
      numberOfWorkers: 1
      appSettings: [
        {
          name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE'
          value: 'false'
        }
        {
          name: 'ASPNETCORE_ENVIRONMENT'
          value: environment
        }
        {
          name: 'WEBSITES_PORT'
          value: '5100'
        }
        {
          name: 'ConnectionStrings__DefaultConnection'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=DbConnectionString)'
        }
        {
          name: 'ConnectionStrings__AzureStorage'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=BlobStorageConnection)'
        }
        {
          name: 'NPS_API_KEY'
          value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=NpsApiKey)'
        }
      ]
    }
  }
}

// Role assignment: Key Vault Secrets User for App Service
resource keyVaultSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(resourceGroup().id, keyVault.name, appService.name)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: appService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Role assignment: Key Vault Secrets User for GitHub Actions deploy SP (preflight validation)
param deploySpObjectId string = '5693632f-69d8-4482-9820-355c3bea04c3'
resource keyVaultSecretsUserRoleDeploy 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(resourceGroup().id, keyVault.name, 'github-deploy-rt')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: deploySpObjectId
    principalType: 'ServicePrincipal'
  }
}

// Outputs
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output sqlDatabaseName string = sqlDatabase.name
output webAppUrl string = 'https://${appService.properties.defaultHostName}'
