using AssetManagement.Core.Interfaces;
using AssetManagement.Core.Models;
using AssetManagement.Core.Queries;
using MediatR;

namespace AssetManagement.Core.Handlers;

public class GetPagedTenantAssetsQueryHandler
    : IRequestHandler<GetPagedTenantAssetsQuery, PagedResult<AssetStatusForTenantDto>>
{
    private readonly IAssetRepository _repository;

    public GetPagedTenantAssetsQueryHandler(IAssetRepository repository)
    {
        _repository = repository;
    }

    public async Task<PagedResult<AssetStatusForTenantDto>> Handle(
        GetPagedTenantAssetsQuery request,
        CancellationToken cancellationToken)
    {
        var paged = await _repository.GetAssetsByTenantPagedAsync(
            request.TenantId,
            request.PageIndex,
            request.PageSize,
            cancellationToken);

        return new PagedResult<AssetStatusForTenantDto>
        {
            Items = paged.Items.Select(a => new AssetStatusForTenantDto
            {
                AssetId = a.AssetId,
                AssetType = a.AssetType,
                AssetName = a.AssetName,
                Status = a.Status,
                LastUpdated = a.LastUpdated,
                UpdatedBy = a.UpdatedBy
            }).ToList(),
            TotalCount = paged.TotalCount,
            PageIndex = paged.PageIndex,
            PageSize = paged.PageSize
        };
    }
}
