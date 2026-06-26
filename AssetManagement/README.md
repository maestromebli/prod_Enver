# Asset Management — .NET 8 MVC

Веб-додаток для перегляду та оновлення статусів активів, згрупованих за **tenant**, з пагінацією.

## Архітектура

| Проєкт                             | Призначення                                                     |
| ---------------------------------- | --------------------------------------------------------------- |
| **AssetManagement.Core**           | Домен, MediatR (queries/commands), інтерфейс `IAssetRepository` |
| **AssetManagement.Infrastructure** | `FakeAssetRepository` (in-memory seed)                          |
| **AssetManagement.Web**            | ASP.NET Core MVC UI                                             |
| **AssetManagement.Tests**          | xUnit                                                           |

## Запуск локально

```bash
cd AssetManagement.Web
dotnet run
```

Відкрийте https://localhost:5001

## Docker

```bash
docker build -f AssetManagement.Web/Dockerfile -t asset-management .
docker run -p 8080:8080 asset-management
```

http://localhost:8080

## Тести

```bash
dotnet test AssetManagement.sln
```

## API (MediatR)

- `GetAssetStatusByTenantQuery` — усі tenant з активами
- `GetPagedAssetStatusByTenantQuery` — пагінація tenant на головній
- `GetPagedTenantAssetsQuery` — пагінація активів tenant на Details
- `UpdateAssetStatusCommand` — оновлення статусу

## UI

- **Index** — tenant посторінково, під кожним — його активи
- **Details** — один tenant, активи з пагінацією
- **Edit** — зміна статусу активу

Статуси: `Active`, `Inactive`, `Maintenance`, `Decommissioned`.

Дані в `FakeAssetRepository` — 3 tenant, 9 активів (демо).
