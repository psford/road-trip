FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Node 20 for the Phase 5 iOS bundle builder (scripts/build-bundle.js).
# .git is excluded by .dockerignore, so the bundle version suffix comes from
# BUNDLE_VERSION_SUFFIX (passed as --build-arg) or falls back to a timestamp.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

ARG BUNDLE_VERSION_SUFFIX=
ENV BUNDLE_VERSION_SUFFIX=$BUNDLE_VERSION_SUFFIX

COPY src/RoadTripMap/RoadTripMap.csproj src/RoadTripMap/
RUN dotnet restore src/RoadTripMap/RoadTripMap.csproj

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build:bundle
RUN dotnet publish src/RoadTripMap/RoadTripMap.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 5100
ENV ASPNETCORE_URLS=http://+:5100
ENTRYPOINT ["dotnet", "RoadTripMap.dll"]
