FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY src/RoadTripMap/RoadTripMap.csproj src/RoadTripMap/
RUN dotnet restore src/RoadTripMap/RoadTripMap.csproj
COPY . .
RUN dotnet publish src/RoadTripMap/RoadTripMap.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 5100
ENV ASPNETCORE_URLS=http://+:5100
ENTRYPOINT ["dotnet", "RoadTripMap.dll"]
