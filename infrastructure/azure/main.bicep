param location string = resourceGroup().location
param appServicePlanResourceId string
param sqlConnectionString string
param storageConnectionString string
param environment string = 'Production'

resource appService 'Microsoft.Web/sites@2023-01-01' = {
  name: 'app-roadtripmap-prod'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlanResourceId
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
          value: sqlConnectionString
        }
        {
          name: 'ConnectionStrings__AzureStorage'
          value: storageConnectionString
        }
      ]
    }
  }
}

output appServiceId string = appService.id
output appServiceName string = appService.name
output appServiceDefaultHostName string = appService.properties.defaultHostName
