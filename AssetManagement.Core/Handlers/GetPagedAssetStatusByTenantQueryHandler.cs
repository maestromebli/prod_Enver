using AssetManagement.Core.Interfaces;
using AssetManagement.Core.Models;
using AssetManagement.Core.Queries;
using MediatR;

namespace AssetManagement.Core.Handlers;

public class GetPagedAssetStatusByTenantQueryHandler
    : IRequestHandler<GetPagedAssetStatusByTenantQuery, PagedResult<TenantAssetsGroupDto>>
{
    private readonly IAssetRepository _repository;

    public GetPagedAssetStatusByTenantQueryHandler(IAssetRepository repository)
    {
        _repository = repository;
    }

    public async Task<PagedResult<TenantAssetsGroupDto>> Handle(
        GetPagedAssetStatusByTenantQuery request,
        CancellationToken cancellationToken)
    {
        var pagedTenants = await _repository.GetAllTenantsPagedAsync(
            request.PageIndex,
            request.PageSize,
            cancellationToken);

        var tenantIds = pagedTenants.Items.Select(t => t.Id).ToList();
        var assetsByTenant = await _repository.GetAssetStatusByTenantIdsAsync(tenantIds, cancellationToken);

        var groups = pagedTenants.Items.Select(tenant =>
        {
            var assets = assetsByTenant.TryGetValue(tenant.Id, out var list)
                ? list
                : new List<AssetSummary>();

            return new TenantAssetsGroupDto
            {
                Tenant = tenant,
                Assets = assets.Select(MapAsset).ToList()
            };
        }).ToList();

        return new PagedResult<TenantAssetsGroupDto>
        {
            Items = groups,
            TotalCount = pagedTenants.TotalCount,
            PageIndex = pagedTenants.PageIndex,
            PageSize = pagedTenants.PageSize
        };
    }

    private static AssetStatusForTenantDto MapAsset(AssetSummary a) => new()
    {
        AssetId = a.AssetId,
        AssetType = a.AssetType,
        AssetName = a.AssetName,
        Status = a.Status,
        LastUpdated = a.LastUpdated,
        UpdatedBy = a.UpdatedBy
    };
}
