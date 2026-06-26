using AssetManagement.Core.Models;
using MediatR;

namespace AssetManagement.Core.Queries;

public record GetAllTenantsQuery : IRequest<List<TenantSummary>>;
