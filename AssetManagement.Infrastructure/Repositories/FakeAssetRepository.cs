using AssetManagement.Core.Enums;
using AssetManagement.Core.Interfaces;
using AssetManagement.Core.Models;

namespace AssetManagement.Infrastructure.Repositories;

public class FakeAssetRepository : IAssetRepository
{
    private readonly Dictionary<Guid, TenantRecord> _tenants = new();
    private readonly Dictionary<Guid, AssetRecord> _assets = new();

    public FakeAssetRepository()
    {
        SeedData();
    }

    public Task<Dictionary<Guid, List<AssetSummary>>> GetAssetStatusByTenantAsync(
        CancellationToken cancellationToken = default)
    {
        var result = _tenants.Keys.ToDictionary(
            tenantId => tenantId,
            tenantId => _assets.Values
                .Where(a => a.TenantId == tenantId)
                .OrderBy(a => a.AssetType)
                .ThenBy(a => a.AssetName)
                .Select(MapAssetSummary)
                .ToList());

        return Task.FromResult(result);
    }

    public Task<List<TenantSummary>> GetAllTenantsAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(GetOrderedTenantSummaries());

    public Task<PagedResult<TenantSummary>> GetAllTenantsPagedAsync(
        int pageIndex,
        int pageSize,
        CancellationToken cancellationToken = default) =>
        Task.FromResult(Page(GetOrderedTenantSummaries(), pageIndex, pageSize));

    public Task<Dictionary<Guid, List<AssetSummary>>> GetAssetStatusByTenantIdsAsync(
        IEnumerable<Guid> tenantIds,
        CancellationToken cancellationToken = default)
    {
        var result = new Dictionary<Guid, List<AssetSummary>>();
        foreach (var tenantId in tenantIds.Distinct())
        {
            if (!_tenants.ContainsKey(tenantId))
            {
                continue;
            }

            result[tenantId] = _assets.Values
                .Where(a => a.TenantId == tenantId)
                .OrderBy(a => a.AssetType)
                .ThenBy(a => a.AssetName)
                .Select(MapAssetSummary)
                .ToList();
        }

        return Task.FromResult(result);
    }

    public Task<PagedResult<AssetSummary>> GetAssetsByTenantPagedAsync(
        Guid tenantId,
        int pageIndex,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        if (!_tenants.ContainsKey(tenantId))
        {
            return Task.FromResult(new PagedResult<AssetSummary>
            {
                Items = new List<AssetSummary>(),
                TotalCount = 0,
                PageIndex = Math.Max(1, pageIndex),
                PageSize = Math.Max(1, pageSize)
            });
        }

        var all = _assets.Values
            .Where(a => a.TenantId == tenantId)
            .OrderBy(a => a.AssetType)
            .ThenBy(a => a.AssetName)
            .Select(MapAssetSummary)
            .ToList();

        return Task.FromResult(Page(all, pageIndex, pageSize));
    }

    public Task<AssetSummary?> GetAssetByIdAsync(Guid assetId, CancellationToken cancellationToken = default)
    {
        if (!_assets.TryGetValue(assetId, out var asset))
        {
            return Task.FromResult<AssetSummary?>(null);
        }

        return Task.FromResult<AssetSummary?>(MapAssetSummary(asset));
    }

    public Task<AssetSummary> UpdateAssetStatusAsync(
        UpdateAssetStatusRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!_assets.TryGetValue(request.AssetId, out var asset))
        {
            throw new KeyNotFoundException($"Актив {request.AssetId} не знайдено.");
        }

        asset.Status = request.NewStatus;
        asset.LastUpdated = DateTime.UtcNow;
        asset.UpdatedBy = string.IsNullOrWhiteSpace(request.UpdatedBy) ? "system" : request.UpdatedBy.Trim();

        return Task.FromResult(MapAssetSummary(asset));
    }

    private List<TenantSummary> GetOrderedTenantSummaries() =>
        _tenants.Values
            .OrderBy(t => t.Name)
            .Select(t => new TenantSummary { Id = t.Id, Name = t.Name, Description = t.Description })
            .ToList();

    private static PagedResult<T> Page<T>(List<T> all, int pageIndex, int pageSize)
    {
        var size = Math.Max(1, pageSize);
        var index = Math.Max(1, pageIndex);
        var skip = (index - 1) * size;

        return new PagedResult<T>
        {
            Items = all.Skip(skip).Take(size).ToList(),
            TotalCount = all.Count,
            PageIndex = index,
            PageSize = size
        };
    }

    private static AssetSummary MapAssetSummary(AssetRecord a) => new()
    {
        AssetId = a.Id,
        AssetType = a.AssetType,
        AssetName = a.AssetName,
        Status = a.Status,
        LastUpdated = a.LastUpdated,
        UpdatedBy = a.UpdatedBy
    };

    private void SeedData()
    {
        var tenantA = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var tenantB = Guid.Parse("22222222-2222-2222-2222-222222222222");
        var tenantC = Guid.Parse("33333333-3333-3333-3333-333333333333");

        _tenants[tenantA] = new TenantRecord(tenantA, "Acme Corp", "Manufacturing tenant");
        _tenants[tenantB] = new TenantRecord(tenantB, "Globex Inc", "Logistics tenant");
        _tenants[tenantC] = new TenantRecord(tenantC, "Initech", "Office IT tenant");

        AddAsset(tenantA, "Server", "WEB-01", AssetStatus.Active, "admin");
        AddAsset(tenantA, "Server", "DB-01", AssetStatus.Maintenance, "ops");
        AddAsset(tenantA, "Network", "FW-01", AssetStatus.Active, "netops");
        AddAsset(tenantB, "Vehicle", "TRUCK-12", AssetStatus.Active, "fleet");
        AddAsset(tenantB, "Vehicle", "TRUCK-15", AssetStatus.Inactive, "fleet");
        AddAsset(tenantB, "Warehouse", "RACK-A3", AssetStatus.Active, "warehouse");
        AddAsset(tenantC, "Workstation", "WS-101", AssetStatus.Active, "it");
        AddAsset(tenantC, "Workstation", "WS-102", AssetStatus.Decommissioned, "it");
        AddAsset(tenantC, "Printer", "PR-01", AssetStatus.Maintenance, "it");
    }

    private void AddAsset(
        Guid tenantId,
        string assetType,
        string assetName,
        AssetStatus status,
        string updatedBy)
    {
        var id = Guid.NewGuid();
        _assets[id] = new AssetRecord
        {
            Id = id,
            TenantId = tenantId,
            AssetType = assetType,
            AssetName = assetName,
            Status = status,
            LastUpdated = DateTime.UtcNow.AddDays(-Random.Shared.Next(1, 30)),
            UpdatedBy = updatedBy
        };
    }

    private sealed class TenantRecord
    {
        public TenantRecord(Guid id, string name, string description)
        {
            Id = id;
            Name = name;
            Description = description;
        }

        public Guid Id { get; }
        public string Name { get; }
        public string Description { get; }
    }

    private sealed class AssetRecord
    {
        public Guid Id { get; set; }
        public Guid TenantId { get; set; }
        public string AssetType { get; set; } = string.Empty;
        public string AssetName { get; set; } = string.Empty;
        public AssetStatus Status { get; set; }
        public DateTime LastUpdated { get; set; }
        public string UpdatedBy { get; set; } = string.Empty;
    }
}
