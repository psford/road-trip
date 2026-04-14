// Cross-RG role assignment helper. Invoked as a module because Bicep requires
// role-assignment scope to match the current deployment's target resource group,
// and the shared storage account lives in a different RG.

@description('Storage account name (must exist in this module\'s target RG).')
param storageAccountName string

@description('Principal (object) id to grant access to.')
param principalId string

@description('Role definition GUID (just the GUID, not the full resource id).')
param roleDefinitionId string

@description('Deterministic role-assignment resource name (a GUID).')
param roleAssignmentName string

@description('Principal type. Defaults to ServicePrincipal.')
param principalType string = 'ServicePrincipal'

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storageAccount
  name: roleAssignmentName
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleDefinitionId)
    principalId: principalId
    principalType: principalType
  }
}
