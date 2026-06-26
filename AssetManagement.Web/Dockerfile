FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY AssetManagement.sln ./
COPY AssetManagement.Core/AssetManagement.Core.csproj AssetManagement.Core/
COPY AssetManagement.Infrastructure/AssetManagement.Infrastructure.csproj AssetManagement.Infrastructure/
COPY AssetManagement.Web/AssetManagement.Web.csproj AssetManagement.Web/
COPY AssetManagement.Tests/AssetManagement.Tests.csproj AssetManagement.Tests/

RUN dotnet restore AssetManagement.sln

COPY . .
RUN dotnet publish AssetManagement.Web/AssetManagement.Web.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENV ASPNETCORE_ENVIRONMENT=Production

COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "AssetManagement.Web.dll"]
