// Creates a single blob container in an existing storage account in this module's target RG.
//
// Invoked as a module because the shared `stockanalyzerblob` account lives in
// rg-stockanalyzer-prod (cross-RG from main.bicep's rg-roadtripmap-prod scope).
//
// IMPORTANT: this only creates a CHILD container — it does NOT touch
// `blobServices/default` properties (CORS, etc.), so it can't clobber the shared
// account's blob-service config (see the CORS note in main.bicep).

@description('Existing storage account name (must exist in this module\'s target RG).')
param storageAccountName string

@description('Container name to create.')
param containerName string

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName

  resource blobService 'blobServices' existing = {
    name: 'default'
  }
}

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: storageAccount::blobService
  name: containerName
  properties: {
    publicAccess: 'None'
  }
}
