// Cross-RG blob-service CORS helper. Invoked as a module because Bicep requires
// a resource's scope to match the deployment's target resource group, and the
// shared storage account lives in a different RG (rg-stockanalyzer-prod). An
// inline blobServices resource parented to a cross-RG `existing` account hits
// BCP165. Mirrors the storage-rbac.bicep pattern.

@description('Storage account name (must exist in this module\'s target RG).')
param storageAccountName string

@description('CORS rules to apply to the blob service (default container).')
param corsRules array

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource blobServices 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    cors: {
      corsRules: corsRules
    }
  }
}
