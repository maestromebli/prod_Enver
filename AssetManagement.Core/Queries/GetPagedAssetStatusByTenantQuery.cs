using AssetManagement.Core.Models;
using MediatR;

namespace AssetManagement.Core.Queries;

/// <summary>
/// Пагінований список tenant з їхніми активами (для головної сторінки).
/// </summary>
public record GetPagedAssetStatusByTenantQuery(int PageIndex = 1, int PageSize = 10)
    : IRequest<PagedResult<TenantAssetsGroupDto>>;
