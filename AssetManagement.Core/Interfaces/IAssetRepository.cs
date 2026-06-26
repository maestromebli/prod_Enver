using AssetManagement.Core.Models;

namespace AssetManagement.Core.Interfaces;

public interface IAssetRepository
{
    Task<Dictionary<Guid, List<AssetSummary>>> GetAssetStatusByTenantAsync(
        CancellationToken cancellationToken = default);

    Task<List<TenantSummary>> GetAllTenantsAsync(CancellationToken cancellationToken = default);

    Task<PagedResult<TenantSummary>> GetAllTenantsPagedAsync(
        int pageIndex,
        int pageSize,
        CancellationToken cancellationToken = default);

    Task<Dictionary<Guid, List<AssetSummary>>> GetAssetStatusByTenantIdsAsync(
        IEnumerable<Guid> tenantIds,
        CancellationToken cancellationToken = default);

    Task<PagedResult<AssetSummary>> GetAssetsByTenantPagedAsync(
        Guid tenantId,
        int pageIndex,
        int pageSize,
        CancellationToken cancellationToken = default);

    Task<AssetSummary?> GetAssetByIdAsync(Guid assetId, CancellationToken cancellationToken = default);

    Task<AssetSummary> UpdateAssetStatusAsync(
        UpdateAssetStatusRequest request,
        CancellationToken cancellationToken = default);
}
