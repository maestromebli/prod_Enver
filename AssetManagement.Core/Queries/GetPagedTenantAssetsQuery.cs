using AssetManagement.Core.Models;
using MediatR;

namespace AssetManagement.Core.Queries;

/// <summary>
/// Пагіновані активи одного tenant (сторінка деталей).
/// </summary>
public record GetPagedTenantAssetsQuery(Guid TenantId, int PageIndex = 1, int PageSize = 20)
    : IRequest<PagedResult<AssetStatusForTenantDto>>;
